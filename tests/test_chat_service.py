from __future__ import annotations

import asyncio
import pytest
from types import SimpleNamespace

from services.supabase.artifact_store import ArtifactStore
from services.supabase.backend import InMemorySupabaseBackend
from services.supabase.chat_message_store import ChatMessageStore
from services.supabase.conversation_store import ConversationStore
from services.supabase.storage import InMemoryStorageBackend


class FakeArtifactService:
    async def load_artifact(self, **kwargs):
        _ = kwargs
        return SimpleNamespace(
            inline_data=SimpleNamespace(data=b"assistant-wav", mime_type="audio/wav")
        )


class FakeADKService:
    def __init__(self) -> None:
        self.app_name = "router-agent"
        self.artifact_service = FakeArtifactService()
        self.session_calls: list[dict[str, str | None]] = []
        self.run_calls: list[dict[str, object]] = []

    async def get_or_create_session(
        self,
        user_id: str,
        conversation_id: str | None = None,
    ) -> str:
        self.session_calls.append(
            {"user_id": user_id, "conversation_id": conversation_id}
        )
        return "session-1"

    def run_agent(
        self,
        *,
        session_id: str,
        user_id: str,
        text: str | None,
        file_data: bytes | None = None,
        mime_type: str | None = None,
    ) -> tuple[str, dict, list]:
        self.run_calls.append(
            {
                "session_id": session_id,
                "user_id": user_id,
                "text": text,
                "file_data": file_data,
                "mime_type": mime_type,
            }
        )
        return "assistant reply", {"assistant.wav": 1}, []


class FailingADKService(FakeADKService):
    def run_agent(self, **kwargs) -> tuple[str, dict, list]:
        self.run_calls.append(kwargs)
        raise RuntimeError("agent failed")


class EmptyADKService(FakeADKService):
    def run_agent(self, **kwargs) -> tuple[str, dict, list]:
        self.run_calls.append(kwargs)
        return "", {}, []


class MultiFileADKService(FakeADKService):
    def run_agent(
        self,
        *,
        session_id: str,
        user_id: str,
        text: str | None,
        file_data: bytes | None = None,
        mime_type: str | None = None,
        file_parts: list[tuple[bytes, str]] | None = None,
    ) -> tuple[str, dict, list]:
        self.run_calls.append(
            {
                "session_id": session_id,
                "user_id": user_id,
                "text": text,
                "file_data": file_data,
                "mime_type": mime_type,
                "file_parts": file_parts,
            }
        )
        return "assistant reply", {"assistant.wav": 1}, []


class ContextAwareADKService(FakeADKService):
    def run_agent(
        self,
        *,
        session_id: str,
        user_id: str,
        text: str | None,
        file_data: bytes | None = None,
        mime_type: str | None = None,
        context_pack_data: dict | None = None,
    ) -> tuple[str, dict, list]:
        self.run_calls.append(
            {
                "session_id": session_id,
                "user_id": user_id,
                "text": text,
                "file_data": file_data,
                "mime_type": mime_type,
                "context_pack_data": context_pack_data,
            }
        )
        return "assistant reply", {}, []


def build_service():
    from services.chat_service import ChatService

    metadata_backend = InMemorySupabaseBackend()
    storage_backend = InMemoryStorageBackend()
    return (
        ChatService(
            adk_service=FakeADKService(),
            conversation_store=ConversationStore(metadata_backend),
            chat_message_store=ChatMessageStore(metadata_backend),
            artifact_store=ArtifactStore(metadata_backend, storage_backend),
        ),
        metadata_backend,
    )


def test_chat_service_persists_text_turn_and_collects_assistant_artifacts() -> None:
    from services.chat_service import ChatRequest

    service, metadata_backend = build_service()

    result = asyncio.run(
        service.process(ChatRequest(user_id="auth-user-123", text="hello"))
    )

    assert result.text == "assistant reply"
    assert result.audio is not None
    assert result.audio.startswith("/api/files/")
    assert result.media[0].data == b"assistant-wav"
    assert result.media[0].mime_type == "audio/wav"
    assert service.adk_service.session_calls == [
        {"user_id": "auth-user-123", "conversation_id": result.conversation_id}
    ]
    assert service.adk_service.run_calls == [
        {
            "session_id": "session-1",
            "user_id": "auth-user-123",
            "text": "hello",
            "file_data": None,
            "mime_type": None,
        }
    ]
    assert service.chat_message_store.list_messages(result.conversation_id) == [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "assistant reply"},
    ]

    artifact_rows = metadata_backend.select(
        "artifacts",
        filters={"user_id": "auth-user-123"},
        order_by="created_at",
    )
    assert [row["artifact_kind"] for row in artifact_rows] == ["assistant_audio"]


def test_chat_service_sends_current_text_without_prompt_history_injection() -> None:
    from services.chat_service import ChatRequest

    service, _metadata_backend = build_service()

    first = asyncio.run(
        service.process(ChatRequest(user_id="auth-user-123", text="Мяне завуць Алесь."))
    )
    second = asyncio.run(
        service.process(
            ChatRequest(
                user_id="auth-user-123",
                conversation_id=first.conversation_id,
                text="Як мяне завуць?",
            )
        )
    )

    assert second.conversation_id == first.conversation_id
    assert service.adk_service.run_calls[1]["text"] == "Як мяне завуць?"


def test_chat_service_passes_compact_context_payload_when_adk_accepts_it() -> None:
    from services.chat_service import ChatRequest, ChatService

    metadata_backend = InMemorySupabaseBackend()
    conversation_store = ConversationStore(metadata_backend)
    chat_message_store = ChatMessageStore(metadata_backend)
    service = ChatService(
        adk_service=ContextAwareADKService(),
        conversation_store=conversation_store,
        chat_message_store=chat_message_store,
        artifact_store=ArtifactStore(metadata_backend, InMemoryStorageBackend()),
    )
    conversation = conversation_store.get_or_create_active_conversation("auth-user-123")
    chat_message_store.append_message(
        conversation["id"], "auth-user-123", "user", "hello"
    )
    chat_message_store.append_message(
        conversation["id"], "auth-user-123", "assistant", "previous reply"
    )

    result = asyncio.run(
        service.process(
            ChatRequest(
                user_id="auth-user-123",
                conversation_id=conversation["id"],
                text="read it aloud",
            )
        )
    )

    payload = service.adk_service.run_calls[0]["context_pack_data"]
    assert result.text == "assistant reply"
    assert payload["conversation_id"] == conversation["id"]
    assert payload["recent_messages"][-1]["role"] == "assistant"
    assert payload["recent_messages"][-1]["text"] == "previous reply"
    assert payload["recent_messages"][-1]["content_type"] == "text"


def test_chat_service_stores_uploads_and_uses_filename_for_history_when_text_empty() -> None:
    from services.chat_service import ChatFile, ChatRequest

    service, metadata_backend = build_service()

    result = asyncio.run(
        service.process(
            ChatRequest(
                user_id="auth-user-123",
                files=[
                    ChatFile(
                        filename="../lesson.png",
                        mime_type="image/png",
                        data=b"png-bytes",
                    )
                ],
            )
        )
    )

    assert result.text == "assistant reply"
    assert service.adk_service.run_calls[0]["text"] is None
    assert service.adk_service.run_calls[0]["file_data"] == b"png-bytes"
    assert service.adk_service.run_calls[0]["mime_type"] == "image/png"
    assert service.chat_message_store.list_messages(result.conversation_id) == [
        {"role": "user", "content": "../lesson.png"},
        {"role": "assistant", "content": "assistant reply"},
    ]

    artifact_rows = metadata_backend.select(
        "artifacts",
        filters={"user_id": "auth-user-123"},
        order_by="created_at",
    )
    assert [row["artifact_kind"] for row in artifact_rows] == [
        "upload",
        "assistant_audio",
    ]
    assert artifact_rows[0]["filename"] == "lesson.png"


def test_chat_service_transcribes_audio_only_upload_before_calling_agent(monkeypatch) -> None:
    from services.chat_service import ChatFile, ChatRequest, ChatService

    async def fake_transcribe(self, attachment):
        _ = self
        assert attachment.filename == "voice.wav"
        return "распазнаны тэкст"

    monkeypatch.setattr(ChatService, "_transcribe_audio_file", fake_transcribe)
    service, _metadata_backend = build_service()

    result = asyncio.run(
        service.process(
            ChatRequest(
                user_id="auth-user-123",
                files=[
                    ChatFile(
                        filename="voice.wav",
                        mime_type="audio/wav",
                        data=b"wav-bytes",
                    )
                ],
            )
        )
    )

    assert result.error is None
    assert service.adk_service.run_calls == [
        {
            "session_id": "session-1",
            "user_id": "auth-user-123",
            "text": "распазнаны тэкст",
            "file_data": None,
            "mime_type": None,
        }
    ]
    assert service.chat_message_store.list_messages(result.conversation_id) == [
        {"role": "user", "content": "распазнаны тэкст"},
        {"role": "assistant", "content": "assistant reply"},
    ]


@pytest.mark.parametrize(
    ("filename", "mime_type", "data"),
    [
        ("photo.png", "image/png", b"png-bytes"),
        ("voice.wav", "audio/wav", b"wav-bytes"),
        ("clip.mp4", "video/mp4", b"mp4-bytes"),
        ("doc.pdf", "application/pdf", b"pdf-bytes"),
        ("notes.txt", "text/plain", b"text-bytes"),
    ],
)
def test_chat_service_forwards_supported_file_inputs_to_adk(filename, mime_type, data) -> None:
    from services.chat_service import ChatFile, ChatRequest

    service, _metadata_backend = build_service()

    result = asyncio.run(
        service.process(
            ChatRequest(
                user_id="auth-user-123",
                text="describe this",
                files=[
                    ChatFile(
                        filename=filename,
                        mime_type=mime_type,
                        data=data,
                    )
                ],
            )
        )
    )

    assert result.error is None
    assert service.adk_service.run_calls == [
        {
            "session_id": "session-1",
            "user_id": "auth-user-123",
            "text": "describe this",
            "file_data": data,
            "mime_type": mime_type,
        }
    ]


def test_chat_service_batches_multiple_files_into_one_adk_turn() -> None:
    from services.chat_service import ChatFile, ChatRequest, ChatService

    metadata_backend = InMemorySupabaseBackend()
    service = ChatService(
        adk_service=MultiFileADKService(),
        conversation_store=ConversationStore(metadata_backend),
        chat_message_store=ChatMessageStore(metadata_backend),
        artifact_store=ArtifactStore(metadata_backend, InMemoryStorageBackend()),
    )

    result = asyncio.run(
        service.process(
            ChatRequest(
                user_id="auth-user-123",
                text="compare these",
                files=[
                    ChatFile(filename="first.png", mime_type="image/png", data=b"one"),
                    ChatFile(filename="second.png", mime_type="image/png", data=b"two"),
                ],
            )
        )
    )

    assert result.error is None
    assert service.adk_service.run_calls == [
        {
            "session_id": "session-1",
            "user_id": "auth-user-123",
            "text": "compare these",
            "file_data": None,
            "mime_type": None,
            "file_parts": [(b"one", "image/png"), (b"two", "image/png")],
        }
    ]


def test_chat_service_forwards_normalized_supported_mime_type_to_adk() -> None:
    from services.chat_service import ChatFile, ChatRequest

    service, _metadata_backend = build_service()

    result = asyncio.run(
        service.process(
            ChatRequest(
                user_id="auth-user-123",
                text="describe this",
                files=[
                    ChatFile(
                        filename="voice.wav",
                        mime_type="audio/x-wav; charset=binary",
                        data=b"wav-bytes",
                    )
                ],
            )
        )
    )

    assert result.error is None
    assert service.adk_service.run_calls[0]["mime_type"] == "audio/wav"


def test_chat_service_resolves_supported_filename_when_mime_type_is_unhelpful() -> None:
    from services.chat_service import ChatFile, ChatRequest

    service, _metadata_backend = build_service()

    result = asyncio.run(
        service.process(
            ChatRequest(
                user_id="auth-user-123",
                text="describe this",
                files=[
                    ChatFile(
                        filename="table.csv",
                        mime_type="application/octet-stream",
                        data=b"a,b\n1,2\n",
                    )
                ],
            )
        )
    )

    assert result.error is None
    assert service.adk_service.run_calls[0]["mime_type"] == "text/csv"


def test_chat_service_converts_browser_webm_recording_to_wav_for_agent() -> None:
    from services.chat_service import ChatFile, ChatRequest

    service, _metadata_backend = build_service()

    result = asyncio.run(
        service.process(
            ChatRequest(
                user_id="auth-user-123",
                text="transcribe this",
                files=[
                    ChatFile(
                        filename="voice-message.webm",
                        mime_type="audio/webm;codecs=opus",
                        data=b"webm-bytes",
                    )
                ],
            )
        )
    )

    assert result.error is None
    assert result.text == "assistant reply"
    sent_file_data = service.adk_service.run_calls[0]["file_data"]
    assert sent_file_data != b"webm-bytes"
    assert sent_file_data[:4] == b"RIFF"
    assert sent_file_data[8:12] == b"WAVE"
    assert service.adk_service.run_calls[0]["mime_type"] == "audio/wav"


def test_chat_service_contract_includes_channel_metadata_error_and_diagnostics() -> None:
    from services.chat_service import ChatFile, ChatRequest, ChatService

    metadata_backend = InMemorySupabaseBackend()
    service = ChatService(
        adk_service=FailingADKService(),
        conversation_store=ConversationStore(metadata_backend),
        chat_message_store=ChatMessageStore(metadata_backend),
        artifact_store=ArtifactStore(metadata_backend, InMemoryStorageBackend()),
    )

    result = asyncio.run(
        service.process(
            ChatRequest(
                user_id="telegram-user-42",
                channel="telegram",
                conversation_id="conversation-from-adapter",
                text="hello",
                files=[
                    ChatFile(
                        filename="photo.jpg",
                        mime_type="image/jpeg",
                        data=b"jpg-bytes",
                    )
                ],
                metadata={"telegram_chat_id": 42},
                error_reply="fallback reply",
            )
        )
    )

    assert result.conversation_id == "conversation-from-adapter"
    assert result.text == "fallback reply"
    assert result.error == "agent failed"
    assert result.diagnostics["channel"] == "telegram"
    assert result.diagnostics["error_type"] == "RuntimeError"
    assert result.diagnostics["metadata"] == {"telegram_chat_id": 42}
    assert result.artifacts == []
    assert service.adk_service.session_calls == [
        {
            "user_id": "telegram-user-42",
            "conversation_id": "conversation-from-adapter",
        }
    ]


def test_chat_service_uses_no_answer_reply_when_agent_returns_no_visible_output() -> None:
    from services.chat_service import ChatRequest, ChatService

    metadata_backend = InMemorySupabaseBackend()
    service = ChatService(
        adk_service=EmptyADKService(),
        conversation_store=ConversationStore(metadata_backend),
        chat_message_store=ChatMessageStore(metadata_backend),
        artifact_store=ArtifactStore(metadata_backend, InMemoryStorageBackend()),
    )

    result = asyncio.run(
        service.process(
            ChatRequest(
                user_id="auth-user-123",
                text="hello",
                no_answer_reply="fallback no answer",
            )
        )
    )

    assert result.text == "fallback no answer"
    assert result.error is None
    assert result.diagnostics["empty_response"] is True
    assert service.chat_message_store.list_messages(result.conversation_id) == [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "fallback no answer"},
    ]


def test_chat_service_text_clear_command_uses_clear_callback_without_agent() -> None:
    from services.chat_service import ChatRequest, ChatService

    metadata_backend = InMemorySupabaseBackend()
    conversation_store = ConversationStore(metadata_backend)
    clear_calls: list[str] = []

    async def clear_chat_session(user_id: str) -> None:
        clear_calls.append(user_id)
        conversation_store.clear_active_conversation(user_id)

    service = ChatService(
        adk_service=FakeADKService(),
        conversation_store=conversation_store,
        chat_message_store=ChatMessageStore(metadata_backend),
        artifact_store=ArtifactStore(metadata_backend, InMemoryStorageBackend()),
        clear_chat_session=clear_chat_session,
    )
    conversation = conversation_store.get_or_create_active_conversation(
        "telegram-user-42"
    )

    result = asyncio.run(
        service.process(
            ChatRequest(
                user_id="telegram-user-42",
                channel="telegram",
                text="\u0430\u0447\u044b\u0441\u0446\u0456 "
                "\u0433\u0456\u0441\u0442\u043e\u0440\u044b\u044e",
            )
        )
    )

    assert result.text
    assert "\u0413\u0456\u0441\u0442\u043e\u0440\u044b\u044f" in result.text
    assert result.conversation_id == conversation["id"]
    assert clear_calls == ["telegram-user-42"]
    assert service.adk_service.run_calls == []
    assert conversation_store.get_active_conversation("telegram-user-42") is None


def test_chat_service_rejects_unsupported_file_without_calling_agent() -> None:
    from services.chat_service import ChatFile, ChatRequest
    from services.gemini_file_policy import unsupported_file_reply

    service, _metadata_backend = build_service()

    result = asyncio.run(
        service.process(
            ChatRequest(
                user_id="auth-user-123",
                files=[
                    ChatFile(
                        filename="archive.zip",
                        mime_type="application/zip",
                        data=b"zip-bytes",
                    )
                ],
            )
        )
    )

    assert result.text == unsupported_file_reply("application/zip")
    assert result.error == "unsupported_file"
    assert result.diagnostics["unsupported_mime_type"] == "application/zip"
    assert service.adk_service.run_calls == []


def test_chat_service_rejects_oversized_video_without_calling_agent() -> None:
    from services.chat_service import ChatFile, ChatRequest
    from services.gemini_file_policy import MAX_INLINE_VIDEO_BYTES

    service, _metadata_backend = build_service()

    result = asyncio.run(
        service.process(
            ChatRequest(
                user_id="auth-user-123",
                files=[
                    ChatFile(
                        filename="clip.mp4",
                        mime_type="video/mp4",
                        data=b"x" * (MAX_INLINE_VIDEO_BYTES + 1),
                    )
                ],
            )
        )
    )

    assert result.text is not None
    assert "20 MB" in result.text
    assert result.error == "video_too_large"
    assert result.diagnostics["max_inline_video_bytes"] == MAX_INLINE_VIDEO_BYTES
    assert service.adk_service.run_calls == []
