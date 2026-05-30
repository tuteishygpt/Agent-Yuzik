from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Tuple

from google.adk.artifacts import InMemoryArtifactService
from google.adk.events import Event
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from bot import helpers
from router_agent.agent import router_agent
from services.supabase.adk_session_store import ADKSessionStore

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


class ADKService:
    def __init__(self, session_store: ADKSessionStore | None = None):
        log.info("Initializing ADKService with REAL components...")
        self.artifact_service = InMemoryArtifactService()
        self.session_service = InMemorySessionService()
        self.runner = Runner(
            agent=router_agent,
            app_name=router_agent.name,
            session_service=self.session_service,
            artifact_service=self.artifact_service,
        )
        self.app_name = router_agent.name
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

        try:
            for ev in self.runner.run(
                user_id=user_id, session_id=session_id, new_message=content
            ):
                if ev.is_final_response() and ev.content:
                    final_parts = ev.content.parts or []
                if ev.actions and ev.actions.artifact_delta:
                    delta.update(ev.actions.artifact_delta)
        except ValueError as exc:
            if _is_unknown_tool_error(exc):
                log.warning("LLM hallucinated unknown tool: %s", exc)
                return _UNKNOWN_TOOL_FALLBACK, {}, [types.Part(text=_UNKNOWN_TOOL_FALLBACK)]
            raise

        reply = "\n".join(p.text for p in final_parts if p.text)
        return reply, delta, final_parts

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
                for ev in self.runner.run(
                    user_id=user_id, session_id=session_id, new_message=content
                ):
                    loop.call_soon_threadsafe(event_queue.put_nowait, ev)
            except ValueError as exc:
                if _is_unknown_tool_error(exc):
                    log.warning("LLM hallucinated unknown tool: %s", exc)
                    fallback_event = Event(
                        author="router_agent",
                        content=types.Content(
                            role="model",
                            parts=[types.Part(text=_UNKNOWN_TOOL_FALLBACK)],
                        ),
                        turnComplete=True,
                    )
                    loop.call_soon_threadsafe(event_queue.put_nowait, fallback_event)
                else:
                    log.error("Error in sync runner: %s", exc)
            except Exception as exc:
                log.error("Error in sync runner: %s", exc)
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
