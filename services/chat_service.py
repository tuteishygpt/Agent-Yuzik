from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any

from google.genai import types

from api.voice_utils import ensure_wav
from services.dialogue_logging import append_dialogue_turn, log_adk_turn
from services.gemini_file_policy import normalize_mime_type, validate_gemini_chat_file

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class ChatFile:
    filename: str
    mime_type: str
    data: bytes
    metadata: dict[str, Any] = field(default_factory=dict)


ChatAttachment = ChatFile


@dataclass(frozen=True)
class ChatRequest:
    user_id: str
    channel: str = "web"
    conversation_id: str | None = None
    text: str = ""
    files: list[ChatFile] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    timeout_seconds: float | None = None
    timeout_reply: str | None = None
    error_reply: str | None = None
    no_answer_reply: str | None = None


@dataclass(frozen=True)
class ChatMedia:
    kind: str
    filename: str
    mime_type: str
    data: bytes
    url: str | None = None


@dataclass(frozen=True)
class ChatResult:
    text: str | None
    artifacts: list[ChatMedia]
    audio: str | None
    image: str | None
    error: str | None
    diagnostics: dict[str, Any]
    conversation_id: str
    session_id: str
    user_history_text: str | None

    @property
    def media(self) -> list[ChatMedia]:
        return self.artifacts


class ChatService:
    def __init__(
        self,
        *,
        adk_service,
        conversation_store,
        chat_message_store,
        artifact_store,
        adk_session_store=None,
    ) -> None:
        self.adk_service = adk_service
        self.conversation_store = conversation_store
        self.chat_message_store = chat_message_store
        self.artifact_store = artifact_store
        self.adk_session_store = adk_session_store

    async def process(self, request: ChatRequest) -> ChatResult:
        if request.conversation_id:
            conversation_id = request.conversation_id
        else:
            conversation = self.conversation_store.get_or_create_active_conversation(
                request.user_id
            )
            conversation_id = conversation["id"]
        session_id = await self.adk_service.get_or_create_session(
            request.user_id,
            conversation_id=conversation_id,
        )

        response_text: str | None = None
        audio_url: str | None = None
        image_url: str | None = None
        artifacts: list[ChatMedia] = []
        error: str | None = None
        diagnostics: dict[str, Any] = {
            "channel": request.channel,
            "metadata": request.metadata,
        }

        text_for_agent = request.text.strip() or None
        history_text_override: str | None = None

        if request.files:
            validation_result = self._validate_files(request.files)
            if validation_result is not None:
                response_text = validation_result.message
                error = validation_result.error
                diagnostics.update(validation_result.diagnostics or {})
                user_history_text = self._history_text(request)
                if user_history_text:
                    self.chat_message_store.append_message(
                        conversation_id,
                        request.user_id,
                        "user",
                        user_history_text,
                    )
                    self.chat_message_store.append_message(
                        conversation_id,
                        request.user_id,
                        "assistant",
                        response_text,
                    )
                    self.conversation_store.touch(conversation_id)
                    log_adk_turn(log, user_text=request.text, assistant_text=response_text)
                    dialogue_log_path = request.metadata.get("dialogue_log_path")
                    if dialogue_log_path:
                        await asyncio.to_thread(
                            append_dialogue_turn,
                            dialogue_log_path,
                            user_id=request.user_id,
                            user_label=request.metadata.get("user_label"),
                            user_text=user_history_text,
                            assistant_text=response_text,
                            logger=log,
                        )
                return ChatResult(
                    text=response_text,
                    artifacts=[],
                    audio=None,
                    image=None,
                    error=error,
                    diagnostics=diagnostics,
                    conversation_id=conversation_id,
                    session_id=session_id,
                    user_history_text=user_history_text,
                )

            audio_only_transcript = None
            if self._should_transcribe_audio_only_request(request, text_for_agent):
                audio_only_transcript = await self._transcribe_audio_file(request.files[0])
                if audio_only_transcript:
                    text_for_agent = audio_only_transcript
                    history_text_override = audio_only_transcript
                    diagnostics["audio_transcript"] = audio_only_transcript

            for attachment in request.files:
                mime_type = normalize_mime_type(attachment.mime_type) or attachment.mime_type
                self.artifact_store.store_user_upload(
                    user_id=request.user_id,
                    conversation_id=conversation_id,
                    filename=attachment.filename,
                    mime_type=mime_type,
                    data=attachment.data,
                    metadata={
                        "source": request.channel,
                        **request.metadata,
                        **attachment.metadata,
                    },
                )

                if audio_only_transcript:
                    agent_file_data, agent_mime_type = None, None
                else:
                    agent_file_data, agent_mime_type = await self._agent_file_payload(
                        attachment
                    )

                reply, delta, parts, run_error, error_type = await self._run_agent(
                    request=request,
                    session_id=session_id,
                    text=text_for_agent,
                    file_data=agent_file_data,
                    mime_type=agent_mime_type,
                )
                if run_error:
                    error = run_error
                    diagnostics["error_type"] = error_type
                response_text = reply or response_text
                artifacts.extend(self._media_from_parts(parts))
                artifact_media = await self._collect_artifacts(
                    user_id=request.user_id,
                    session_id=session_id,
                    conversation_id=conversation_id,
                    delta=delta,
                )
                artifacts.extend(artifact_media)
                audio_url = self._first_url(artifact_media, "audio") or audio_url
                image_url = self._first_url(artifact_media, "image") or image_url
                text_for_agent = None
        elif text_for_agent:
            reply, delta, parts, run_error, error_type = await self._run_agent(
                request=request,
                session_id=session_id,
                text=text_for_agent,
                file_data=None,
                mime_type=None,
            )
            if run_error:
                error = run_error
                diagnostics["error_type"] = error_type
            response_text = reply or response_text
            artifacts.extend(self._media_from_parts(parts))
            artifact_media = await self._collect_artifacts(
                user_id=request.user_id,
                session_id=session_id,
                conversation_id=conversation_id,
                delta=delta,
            )
            artifacts.extend(artifact_media)
            audio_url = self._first_url(artifact_media, "audio") or audio_url
            image_url = self._first_url(artifact_media, "image") or image_url

        user_history_text = self._history_text(request, text_override=history_text_override)
        if (
            request.no_answer_reply is not None
            and not self._has_visible_output(
                request=request,
                response_text=response_text,
                artifacts=artifacts,
                audio_url=audio_url,
                image_url=image_url,
            )
        ):
            response_text = request.no_answer_reply
            diagnostics["empty_response"] = True

        if user_history_text:
            self.chat_message_store.append_message(
                conversation_id,
                request.user_id,
                "user",
                user_history_text,
            )
            if response_text:
                self.chat_message_store.append_message(
                    conversation_id,
                    request.user_id,
                    "assistant",
                    response_text,
                )
            self.conversation_store.touch(conversation_id)
            log_adk_turn(log, user_text=request.text, assistant_text=response_text)
            dialogue_log_path = request.metadata.get("dialogue_log_path")
            if dialogue_log_path:
                await asyncio.to_thread(
                    append_dialogue_turn,
                    dialogue_log_path,
                    user_id=request.user_id,
                    user_label=request.metadata.get("user_label"),
                    user_text=user_history_text,
                    assistant_text=response_text,
                    logger=log,
                )

        return ChatResult(
            text=response_text,
            artifacts=artifacts,
            audio=audio_url,
            image=image_url,
            error=error,
            diagnostics=diagnostics,
            conversation_id=conversation_id,
            session_id=session_id,
            user_history_text=user_history_text,
        )

    async def _run_agent(
        self,
        *,
        request: ChatRequest,
        session_id: str,
        text: str | None,
        file_data: bytes | None,
        mime_type: str | None,
    ) -> tuple[str, dict, list[types.Part], str | None, str | None]:
        try:
            coro = asyncio.to_thread(
                self.adk_service.run_agent,
                session_id=session_id,
                user_id=request.user_id,
                text=text,
                file_data=file_data,
                mime_type=mime_type,
            )
            if request.timeout_seconds is not None:
                reply, delta, parts = await asyncio.wait_for(
                    coro, timeout=request.timeout_seconds
                )
            else:
                reply, delta, parts = await coro
            return reply, delta, parts, None, None
        except asyncio.TimeoutError as exc:
            if request.timeout_reply is not None:
                return request.timeout_reply, {}, [], str(exc), "TimeoutError"
            raise
        except Exception as exc:
            if request.error_reply is not None:
                log.exception("Error running chat agent for user %s", request.user_id)
                return request.error_reply, {}, [], str(exc), exc.__class__.__name__
            raise

    async def _agent_file_payload(self, attachment: ChatFile) -> tuple[bytes, str | None]:
        mime_type = normalize_mime_type(attachment.mime_type)
        if mime_type == "audio/webm":
            return await asyncio.to_thread(ensure_wav, attachment.data), "audio/wav"
        return attachment.data, mime_type

    def _should_transcribe_audio_only_request(
        self,
        request: ChatRequest,
        text_for_agent: str | None,
    ) -> bool:
        if text_for_agent or len(request.files) != 1:
            return False
        mime_type = normalize_mime_type(request.files[0].mime_type)
        return bool(mime_type and mime_type.startswith("audio/"))

    async def _transcribe_audio_file(self, attachment: ChatFile) -> str | None:
        try:
            wav_data = await asyncio.to_thread(ensure_wav, attachment.data)
            from api.voice_simple import _transcribe_audio_with_model

            transcript = await _transcribe_audio_with_model(wav_data)
        except Exception:
            log.exception("Failed to transcribe audio-only chat upload")
            return None
        transcript = transcript.strip()
        return transcript or None

    async def _collect_artifacts(
        self,
        *,
        user_id: str,
        session_id: str,
        conversation_id: str,
        delta: dict,
    ) -> list[ChatMedia]:
        collected: list[ChatMedia] = []
        for filename, version in delta.items():
            try:
                part = await self.adk_service.artifact_service.load_artifact(
                    app_name=getattr(self.adk_service, "app_name", "app"),
                    user_id=user_id,
                    session_id=session_id,
                    filename=filename,
                    version=version,
                )
                inline_data = getattr(part, "inline_data", None)
                data = getattr(inline_data, "data", None)
                if not data:
                    continue
                mime_type = getattr(inline_data, "mime_type", "")
                active_session = None
                if self.adk_session_store is not None:
                    try:
                        active_session = self.adk_session_store.get_active_session(
                            user_id,
                            getattr(self.adk_service, "app_name", "app"),
                        )
                    except Exception as exc:
                        log.error("Error resolving ADK session row for artifact: %s", exc)
                row = self.artifact_store.store_assistant_artifact(
                    user_id=user_id,
                    conversation_id=conversation_id,
                    filename=filename,
                    mime_type=mime_type or "application/octet-stream",
                    data=data,
                    adk_session_row_id=active_session["id"] if active_session else None,
                    metadata={"version": version, "session_id": session_id},
                )
                collected.append(
                    ChatMedia(
                        kind=self._media_kind(mime_type),
                        filename=filename,
                        mime_type=mime_type,
                        data=data,
                        url=self.artifact_store.get_download_url(row),
                    )
                )
            except Exception as exc:
                log.error("Error loading chat artifact %s: %s", filename, exc)
        return collected

    def _media_from_parts(self, parts: list[types.Part]) -> list[ChatMedia]:
        media: list[ChatMedia] = []
        for index, part in enumerate(parts):
            inline_data = getattr(part, "inline_data", None)
            data = getattr(inline_data, "data", None)
            mime_type = getattr(inline_data, "mime_type", None)
            if not data or not mime_type:
                continue
            media.append(
                ChatMedia(
                    kind=self._media_kind(mime_type),
                    filename=f"part-{index}",
                    mime_type=mime_type,
                    data=data,
                    url=None,
                )
            )
        return media

    def _history_text(
        self,
        request: ChatRequest,
        *,
        text_override: str | None = None,
    ) -> str | None:
        if text_override:
            return text_override
        if request.text:
            return request.text
        if request.files:
            return ", ".join(attachment.filename for attachment in request.files)
        return None

    def _validate_files(self, files: list[ChatFile]):
        for attachment in files:
            result = validate_gemini_chat_file(
                mime_type=attachment.mime_type,
                size_bytes=len(attachment.data),
            )
            if not result.supported:
                return result
        return None

    def _first_url(self, media: list[ChatMedia], kind: str) -> str | None:
        for item in media:
            if item.kind == kind and item.url:
                return item.url
        return None

    def _has_visible_output(
        self,
        *,
        request: ChatRequest,
        response_text: str | None,
        artifacts: list[ChatMedia],
        audio_url: str | None,
        image_url: str | None,
    ) -> bool:
        if response_text and response_text.strip():
            return True
        if audio_url or image_url:
            return True
        return request.channel != "web" and bool(artifacts)

    def _media_kind(self, mime_type: str | None) -> str:
        if mime_type and mime_type.startswith("audio"):
            return "audio"
        if mime_type and mime_type.startswith("image"):
            return "image"
        return "file"
