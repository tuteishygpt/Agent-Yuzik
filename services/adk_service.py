from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from typing import Dict, List, Tuple

import config
from google.adk.artifacts import InMemoryArtifactService
from google.adk.events import Event
from google.adk.runners import Runner
from google.adk.sessions import BaseSessionService, DatabaseSessionService
from google.genai import types

from bot import helpers
from router_agent.agent import router_agent
from services.supabase.adk_session_store import ADKSessionStore
from yuzik_workflow import create_yuzik_workflow

log = logging.getLogger(__name__)


_UNKNOWN_TOOL_FALLBACK = (
    "Прабачце, мадэль паспрабавала выклікаць інструмент, якога ў мяне няма. "
    "Сфармулюйце запыт інакш ці паспрабуйце пазней."
)

def _is_unknown_tool_error(exc: BaseException) -> bool:
    if not isinstance(exc, ValueError):
        return False
    msg = str(exc)
    return "not found" in msg and ("tools_dict" in msg or "Available tools" in msg or "Tool '" in msg)


def _extract_explicit_tts_target_text(text: str | None) -> str | None:
    if not text:
        return None
    markers = ("text:", "тэкст:", "текст:", "слова:", "слово:")
    lowered = text.lower()
    marker_positions = [
        (lowered.find(marker), marker)
        for marker in markers
        if lowered.find(marker) >= 0
    ]
    if not marker_positions:
        return None
    position, marker = min(marker_positions, key=lambda item: item[0])
    target = text[position + len(marker) :].strip(" \t\r\n:.,-\"'“”«»")
    return target or None


def _tts_requested_from_state_delta(state_delta: dict | None) -> bool:
    if not state_delta:
        return False
    return (
        state_delta.get("user:tts_requested_for_turn") is True
        or state_delta.get("temp:tts_requested") is True
    )


def _run_async_blocking(coro_factory):
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro_factory())

    with ThreadPoolExecutor(max_workers=1) as executor:
        return executor.submit(lambda: asyncio.run(coro_factory())).result()


class _ServiceTTSContext:
    def __init__(
        self,
        *,
        artifact_service,
        app_name: str,
        user_id: str,
        session_id: str,
        delta: dict,
    ):
        self._artifact_service = artifact_service
        self._app_name = app_name
        self._user_id = user_id
        self._session_id = session_id
        self._delta = delta
        self._invocation_context = SimpleNamespace(user_id=user_id)

    async def save_artifact(self, *, filename: str, artifact: types.Part, **kwargs):
        version = await self._artifact_service.save_artifact(
            app_name=self._app_name,
            user_id=self._user_id,
            session_id=self._session_id,
            filename=filename,
            artifact=artifact,
            **kwargs,
        )
        self._delta[filename] = version
        return artifact


class ADKEventError(RuntimeError):
    def __init__(self, error_code: str | None, error_message: str | None) -> None:
        self.error_code = error_code or "ADK_EVENT_ERROR"
        self.error_message = error_message or self.error_code
        super().__init__(self.error_message)


def _error_from_event(ev: Event) -> ADKEventError | None:
    error_code = getattr(ev, "error_code", None)
    error_message = getattr(ev, "error_message", None)
    if error_code or error_message:
        return ADKEventError(error_code, error_message)
    return None


def _fallback_event(text: str) -> Event:
    return Event(
        author="router_agent",
        content=types.Content(
            role="model",
            parts=[types.Part(text=text)],
        ),
        turnComplete=True,
    )


def create_session_service() -> BaseSessionService:
    return DatabaseSessionService(db_url=config.ADK_SESSION_DB_URL)


class ADKService:
    def __init__(
        self,
        session_store: ADKSessionStore | None = None,
        session_service: BaseSessionService | None = None,
    ):
        log.info("Initializing ADKService with REAL components...")
        self.artifact_service = InMemoryArtifactService()
        self.session_service = session_service or create_session_service()
        self.workflow = create_yuzik_workflow()
        self.app_name = self.workflow.name
        self.runner = Runner(
            node=self.workflow,
            app_name=self.app_name,
            session_service=self.session_service,
            artifact_service=self.artifact_service,
        )
        self.streaming_runner = Runner(
            agent=router_agent,
            app_name=self.app_name,
            session_service=self.session_service,
            artifact_service=self.artifact_service,
        )
        self.session_store = session_store or ADKSessionStore()

    async def get_or_create_session(
        self,
        user_id: str,
        conversation_id: str | None = None,
    ) -> str:
        active_session = self.session_store.get_active_session(user_id, self.app_name)
        if active_session:
            session_id = active_session["adk_session_id"]
            session = await self.session_service.get_session(
                app_name=self.app_name,
                user_id=user_id,
                session_id=session_id,
            )
            if session is None:
                log.info(
                    "Restoring ADK runtime session %s for user %s",
                    session_id,
                    user_id,
                )
                await self.session_service.create_session(
                    app_name=self.app_name,
                    user_id=user_id,
                    session_id=session_id,
                )

            if conversation_id and active_session.get("conversation_id") != conversation_id:
                self.session_store.set_active_session(
                    user_id=user_id,
                    app_name=self.app_name,
                    adk_session_id=session_id,
                    conversation_id=conversation_id,
                )

            return session_id

        log.info("Creating new session for user %s", user_id)
        session = await self.session_service.create_session(
            app_name=self.app_name, user_id=user_id
        )
        self.session_store.set_active_session(
            user_id=user_id,
            app_name=self.app_name,
            adk_session_id=session.id,
            conversation_id=conversation_id,
        )
        return session.id

    def run_agent(
        self,
        session_id: str,
        user_id: str,
        text: str | None,
        file_data: bytes | None = None,
        mime_type: str | None = None,
    ) -> Tuple[str, Dict, List[types.Part]]:
        parts = []
        if text:
            parts.append(types.Part(text=text))
        if file_data and mime_type:
            blob = types.Blob(data=file_data, mime_type=mime_type)
            parts.append(types.Part(inline_data=blob))

        if not parts:
            return "", {}, []

        content = types.Content(role="user", parts=parts)
        final_parts, delta = [], {}
        tts_requested = False

        try:
            for ev in self.runner.run(
                user_id=user_id, session_id=session_id, new_message=content
            ):
                event_error = _error_from_event(ev)
                if event_error is not None:
                    raise event_error
                if ev.is_final_response() and ev.content:
                    final_parts = ev.content.parts or []
                if ev.actions and ev.actions.artifact_delta:
                    delta.update(ev.actions.artifact_delta)
                state_delta = getattr(getattr(ev, "actions", None), "state_delta", None)
                if _tts_requested_from_state_delta(state_delta):
                    tts_requested = True
        except ValueError as exc:
            if _is_unknown_tool_error(exc):
                log.warning("LLM hallucinated unknown tool: %s", exc)
                return _UNKNOWN_TOOL_FALLBACK, {}, [types.Part(text=_UNKNOWN_TOOL_FALLBACK)]
            raise

        reply = "\n".join(p.text for p in final_parts if p.text)
        self._maybe_run_service_tts_post_action(
            user_id=user_id,
            session_id=session_id,
            text=text,
            reply=reply,
            final_parts=final_parts,
            delta=delta,
            tts_requested=tts_requested,
        )
        reply = "\n".join(p.text for p in final_parts if p.text)
        return reply, delta, final_parts

    def _maybe_run_service_tts_post_action(
        self,
        *,
        user_id: str,
        session_id: str,
        text: str | None,
        reply: str,
        final_parts: list[types.Part],
        delta: dict,
        tts_requested: bool = False,
    ) -> None:
        if not text or not reply:
            return

        if not tts_requested:
            return
        if any(
            getattr(getattr(part, "inline_data", None), "mime_type", "").startswith(
                "audio"
            )
            for part in final_parts
        ):
            return

        target_text = _extract_explicit_tts_target_text(text)
        speech_text = target_text or reply
        if target_text:
            media_parts = [
                part for part in final_parts if not getattr(part, "text", None)
            ]
            final_parts[:] = [types.Part(text=target_text), *media_parts]

        context = _ServiceTTSContext(
            artifact_service=self.artifact_service,
            app_name=self.app_name,
            user_id=user_id,
            session_id=session_id,
            delta=delta,
        )

        def synthesize():
            from tools.text_to_speech_tool import synthesize_speech

            return synthesize_speech(text=speech_text, tool_context=context)

        audio_part = _run_async_blocking(synthesize)
        if isinstance(audio_part, types.Part):
            final_parts.append(audio_part)

    async def run_agent_stream(
        self,
        session_id: str,
        user_id: str,
        text: str | None,
        file_data: bytes | None = None,
        mime_type: str | None = None,
    ):
        parts = []
        if text:
            parts.append(types.Part(text=text))
        if file_data and mime_type:
            if mime_type == "audio/wav" or (
                file_data.startswith(b"RIFF") and file_data[8:12] == b"WAVE"
            ):
                blob = types.Blob(data=file_data, mime_type="audio/wav")
            else:
                blob = types.Blob(data=file_data, mime_type=mime_type)
            parts.append(types.Part(inline_data=blob))

        if not parts:
            return

        content = types.Content(role="user", parts=parts)

        loop = asyncio.get_running_loop()
        event_queue: asyncio.Queue = asyncio.Queue()

        def sync_run_and_push() -> None:
            try:
                for ev in self.streaming_runner.run(
                    user_id=user_id, session_id=session_id, new_message=content
                ):
                    event_error = _error_from_event(ev)
                    if event_error is not None:
                        log.warning(
                            "ADK event error in stream: %s: %s",
                            event_error.error_code,
                            event_error.error_message,
                        )
                        loop.call_soon_threadsafe(
                            event_queue.put_nowait,
                            _fallback_event(config.DEFAULT_ERROR),
                        )
                        break
                    loop.call_soon_threadsafe(event_queue.put_nowait, ev)
            except ValueError as exc:
                if _is_unknown_tool_error(exc):
                    log.warning("LLM hallucinated unknown tool: %s", exc)
                    loop.call_soon_threadsafe(
                        event_queue.put_nowait,
                        _fallback_event(_UNKNOWN_TOOL_FALLBACK),
                    )
                else:
                    log.error("Error in sync runner: %s", exc)
                    loop.call_soon_threadsafe(
                        event_queue.put_nowait,
                        _fallback_event(config.DEFAULT_ERROR),
                    )
            except Exception as exc:
                log.error("Error in sync runner: %s", exc)
                loop.call_soon_threadsafe(
                    event_queue.put_nowait,
                    _fallback_event(config.DEFAULT_ERROR),
                )
            finally:
                loop.call_soon_threadsafe(event_queue.put_nowait, None)

        executor = ThreadPoolExecutor(max_workers=1)
        loop.run_in_executor(executor, sync_run_and_push)

        while True:
            ev = await event_queue.get()
            if ev is None:
                break
            yield ev

    async def send_media_from_parts(
        self, chat_id: int, context, parts: List[types.Part]
    ) -> Tuple[bool, bytes | None, bytes | None]:
        wavs, imgs = [], []
        for p in parts:
            if p.inline_data and p.inline_data.data and p.inline_data.mime_type:
                mime = p.inline_data.mime_type
                if mime.startswith("audio"):
                    wavs.append(p.inline_data.data)
                elif mime.startswith("image"):
                    imgs.append(p.inline_data.data)
        sent = False
        if wavs:
            sent |= await helpers.send_wavs(chat_id, context, wavs)
        if imgs:
            sent |= await helpers.send_images(chat_id, context, imgs)
        return sent, (wavs[0] if wavs else None), (imgs[0] if imgs else None)

    async def send_media_from_artifacts(
        self, chat_id: int, context, user_id: str, session_id: str, delta: Dict
    ) -> Tuple[bool, bytes | None, bytes | None]:
        wavs, imgs = [], []
        for fname, ver in delta.items():
            try:
                part = await self.artifact_service.load_artifact(
                    app_name=self.app_name,
                    user_id=user_id,
                    session_id=session_id,
                    filename=fname,
                    version=ver,
                )
                if part and part.inline_data and part.inline_data.data and part.inline_data.mime_type:
                    mime = part.inline_data.mime_type
                    if mime.startswith("audio"):
                        wavs.append(part.inline_data.data)
                    elif mime.startswith("image"):
                        imgs.append(part.inline_data.data)
            except Exception as exc:
                log.error("Failed to load artifact %s v%s: %s", fname, ver, exc)
        sent = False
        if wavs:
            sent |= await helpers.send_wavs(chat_id, context, wavs)
        if imgs:
            sent |= await helpers.send_images(chat_id, context, imgs)
        return sent, (wavs[0] if wavs else None), (imgs[0] if imgs else None)
