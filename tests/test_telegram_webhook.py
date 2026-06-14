from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import config
from app import app


class FakeTelegramUpdate:
    calls: list[dict] = []

    @staticmethod
    def de_json(data: dict, bot: object) -> dict:
        FakeTelegramUpdate.calls.append({"data": data, "bot": bot})
        return {"update": data, "bot": bot}


class FakeTelegramApplication:
    def __init__(self) -> None:
        self.bot = object()
        self.bot_data: dict[str, object] = {}
        self.handlers: list[object] = []
        self.processed_updates: list[object] = []
        self.initialized = False
        self.started = False
        self.stopped = False
        self.shutdown_done = False

    def add_handler(self, handler: object) -> None:
        self.handlers.append(handler)

    async def initialize(self) -> None:
        self.initialized = True

    async def start(self) -> None:
        self.started = True

    async def stop(self) -> None:
        self.stopped = True

    async def shutdown(self) -> None:
        self.shutdown_done = True

    async def process_update(self, update: object) -> None:
        self.processed_updates.append(update)


class FakeApplicationBuilder:
    built_app: FakeTelegramApplication | None = None
    token_value: str | None = None

    def token(self, token: str) -> "FakeApplicationBuilder":
        self.token_value = token
        FakeApplicationBuilder.token_value = token
        return self

    def build(self) -> FakeTelegramApplication:
        FakeApplicationBuilder.built_app = FakeTelegramApplication()
        return FakeApplicationBuilder.built_app


@pytest.fixture(autouse=True)
def reset_telegram_module(monkeypatch: pytest.MonkeyPatch):
    from api import telegram as telegram_module

    monkeypatch.setattr(config, "LOCAL_ASR", False)
    monkeypatch.setattr(config, "TELEGRAM_BOT_TOKEN", None)
    monkeypatch.setattr(config, "WEBHOOK_SECRET_TOKEN", None)
    monkeypatch.setattr(telegram_module, "telegram_application", None)
    monkeypatch.setattr(telegram_module, "_telegram_started", False)
    FakeTelegramUpdate.calls.clear()
    FakeApplicationBuilder.built_app = None
    FakeApplicationBuilder.token_value = None
    yield
    monkeypatch.setattr(telegram_module, "telegram_application", None)
    monkeypatch.setattr(telegram_module, "_telegram_started", False)


def test_startup_configures_telegram_application_without_network(monkeypatch: pytest.MonkeyPatch) -> None:
    from api import telegram as telegram_module

    fake_adk_service = object()
    monkeypatch.setattr(config, "TELEGRAM_BOT_TOKEN", "123:ABC")
    monkeypatch.setattr(telegram_module, "ApplicationBuilder", FakeApplicationBuilder)

    asyncio.run(telegram_module.configure_telegram_application(fake_adk_service))

    fake_app = FakeApplicationBuilder.built_app
    assert fake_app is telegram_module.telegram_application
    assert FakeApplicationBuilder.token_value == "123:ABC"
    assert fake_app is not None
    assert fake_app.bot_data["adk_service"] is fake_adk_service
    assert fake_app.bot_data["chat_service"].adk_service is fake_adk_service
    assert len(fake_app.handlers) == 2
    assert fake_app.initialized is False
    assert fake_app.started is False


def test_webhook_processes_update_and_starts_application_lazily(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app as app_module
    from api import telegram as telegram_module

    fake_app = FakeTelegramApplication()

    async def keep_fake_application(adk_service: object | None):
        return fake_app

    monkeypatch.setattr(app_module, "configure_telegram_application", keep_fake_application)
    monkeypatch.setattr(telegram_module, "telegram_application", fake_app)
    monkeypatch.setattr(telegram_module, "Update", FakeTelegramUpdate)

    with TestClient(app) as client:
        response = client.post("/telegram-webhook", json={"update_id": 42})

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert fake_app.initialized is True
    assert fake_app.started is True
    assert FakeTelegramUpdate.calls == [{"data": {"update_id": 42}, "bot": fake_app.bot}]
    assert fake_app.processed_updates == [{"update": {"update_id": 42}, "bot": fake_app.bot}]


def test_webhook_rejects_invalid_secret_token(monkeypatch: pytest.MonkeyPatch) -> None:
    from api import telegram as telegram_module

    fake_app = FakeTelegramApplication()
    monkeypatch.setattr(config, "WEBHOOK_SECRET_TOKEN", "secret")
    monkeypatch.setattr(telegram_module, "telegram_application", fake_app)
    monkeypatch.setattr(telegram_module, "Update", FakeTelegramUpdate)

    with TestClient(app) as client:
        response = client.post(
            "/telegram-webhook",
            json={"update_id": 42},
            headers={"X-Telegram-Bot-Api-Secret-Token": "wrong"},
        )

    assert response.status_code == 403
    assert fake_app.processed_updates == []
    assert FakeTelegramUpdate.calls == []


def test_handler_reads_adk_service_from_application_bot_data() -> None:
    from bot.handlers import get_context_adk_service

    fake_service = object()
    context = SimpleNamespace(application=SimpleNamespace(bot_data={"adk_service": fake_service}))

    assert get_context_adk_service(context) is fake_service


def test_handler_reads_chat_service_from_application_bot_data() -> None:
    from bot.handlers import get_context_chat_service

    fake_service = object()
    context = SimpleNamespace(application=SimpleNamespace(bot_data={"chat_service": fake_service}))

    assert get_context_chat_service(context) is fake_service


def test_telegram_chat_service_wires_clear_chat_session_callback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from api import telegram as telegram_module
    from services.supabase.adk_session_store import ADKSessionStore
    from services.supabase.backend import InMemorySupabaseBackend
    from services.supabase.chat_message_store import ChatMessageStore
    from services.supabase.conversation_store import ConversationStore

    class FakeADKService:
        app_name = "router-agent"

        def __init__(self) -> None:
            self.clear_calls: list[str] = []

        async def clear_chat_context_state(self, user_id: str) -> None:
            self.clear_calls.append(user_id)

    backend = InMemorySupabaseBackend()
    conversation_store = ConversationStore(backend)
    adk_session_store = ADKSessionStore(backend)
    fake_adk_service = FakeADKService()
    conversation = conversation_store.get_or_create_active_conversation("telegram-user")
    adk_session_store.set_active_session(
        user_id="telegram-user",
        app_name=fake_adk_service.app_name,
        adk_session_id="session-1",
        conversation_id=conversation["id"],
    )

    monkeypatch.setattr(telegram_module, "conversation_store", conversation_store)
    monkeypatch.setattr(
        telegram_module,
        "chat_message_store",
        ChatMessageStore(backend),
    )
    monkeypatch.setattr(telegram_module, "adk_session_store", adk_session_store)

    chat_service = telegram_module._build_chat_service(fake_adk_service)

    assert chat_service.clear_chat_session is not None
    asyncio.run(chat_service.clear_chat_session("telegram-user"))
    assert fake_adk_service.clear_calls == ["telegram-user"]
    assert conversation_store.get_active_conversation("telegram-user") is None
    assert (
        adk_session_store.get_active_session(
            "telegram-user",
            fake_adk_service.app_name,
        )
        is None
    )


def test_telegram_media_renderer_sends_generic_artifacts_as_documents(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from bot import handlers
    from services.chat_service import ChatMedia

    sent_docs: list[tuple[bytes, str]] = []

    async def fake_send_documents(chat_id: int, context: object, documents):
        _ = chat_id
        _ = context
        sent_docs.extend(list(documents))
        return True

    monkeypatch.setattr(handlers.helpers, "send_documents", fake_send_documents)

    sent, audio, image = asyncio.run(
        handlers._send_media_from_chat_result(
            42,
            object(),
            [
                ChatMedia(
                    kind="file",
                    filename="report.pdf",
                    mime_type="application/pdf",
                    data=b"pdf-bytes",
                    url="/api/files/1",
                )
            ],
        )
    )

    assert sent is True
    assert audio is None
    assert image is None
    assert sent_docs == [(b"pdf-bytes", "report.pdf")]


def test_telegram_media_renderer_deduplicates_audio_artifacts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from bot import handlers
    from services.chat_service import ChatMedia

    sent_wavs: list[bytes] = []

    async def fake_send_wavs(chat_id: int, context: object, wavs):
        _ = chat_id
        _ = context
        sent_wavs.extend(wavs)
        return True

    monkeypatch.setattr(handlers.helpers, "send_wavs", fake_send_wavs)

    sent, audio, image = asyncio.run(
        handlers._send_media_from_chat_result(
            42,
            object(),
            [
                ChatMedia(
                    kind="audio",
                    filename="part-0",
                    mime_type="audio/wav",
                    data=b"same-audio",
                    url=None,
                ),
                ChatMedia(
                    kind="audio",
                    filename="speech.wav",
                    mime_type="audio/wav",
                    data=b"same-audio",
                    url="/api/files/1",
                ),
            ],
        )
    )

    assert sent is True
    assert audio == b"same-audio"
    assert image is None
    assert sent_wavs == [b"same-audio"]


def test_telegram_voice_message_uses_transcript_as_chat_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from bot import handlers
    from services.chat_service import ChatResult

    captured_requests = []
    sent_messages = []

    class FakeChatService:
        async def process(self, request):
            captured_requests.append(request)
            return ChatResult(
                text="казка",
                artifacts=[],
                audio=None,
                image=None,
                error=None,
                diagnostics={},
                conversation_id="conversation-1",
                session_id="session-1",
                user_history_text=request.text,
            )

    class FakeDownloadedFile:
        async def download_to_memory(self, stream):
            stream.write(b"telegram-ogg")

    class FakeBot:
        async def get_file(self, file_id):
            assert file_id == "voice-file-id"
            return FakeDownloadedFile()

        async def send_chat_action(self, chat_id, action):
            return None

        async def send_message(self, chat_id, text):
            sent_messages.append((chat_id, text))
            return None

    async def fake_transcribe(file_data: bytes, mime_type: str | None) -> str:
        assert file_data == b"telegram-ogg"
        assert mime_type == "audio/ogg"
        return "раскажы казку"

    monkeypatch.setattr(handlers, "_transcribe_telegram_voice", fake_transcribe)
    monkeypatch.setattr(handlers, "save_message", lambda **kwargs: None)

    update = SimpleNamespace(
        effective_chat=SimpleNamespace(id=42),
        effective_user=SimpleNamespace(id=7, first_name="User", username="tester"),
        message=SimpleNamespace(
            text=None,
            caption=None,
            document=None,
            photo=None,
            audio=None,
            voice=SimpleNamespace(
                file_id="voice-file-id",
                file_unique_id="voice-unique-id",
                mime_type="audio/ogg",
            ),
            video=None,
            video_note=None,
            animation=None,
            sticker=None,
        ),
    )
    context = SimpleNamespace(
        bot=FakeBot(),
        application=SimpleNamespace(bot_data={"chat_service": FakeChatService()}),
    )

    asyncio.run(handlers._process_message_task(update, context))

    assert len(captured_requests) == 1
    assert captured_requests[0].text == "раскажы казку"
    assert captured_requests[0].files == []
    assert sent_messages == [(42, "казка")]


def test_telegram_dialogue_user_label_prefers_username() -> None:
    from bot.handlers import _telegram_dialogue_user_label

    assert _telegram_dialogue_user_label(SimpleNamespace(id=42, username="nickname")) == "@nickname"


def test_telegram_dialogue_user_label_falls_back_to_id() -> None:
    from bot.handlers import _telegram_dialogue_user_label

    assert _telegram_dialogue_user_label(SimpleNamespace(id=42, username=None)) == "42"
