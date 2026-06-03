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


def test_telegram_dialogue_user_label_prefers_username() -> None:
    from bot.handlers import _telegram_dialogue_user_label

    assert _telegram_dialogue_user_label(SimpleNamespace(id=42, username="nickname")) == "@nickname"


def test_telegram_dialogue_user_label_falls_back_to_id() -> None:
    from bot.handlers import _telegram_dialogue_user_label

    assert _telegram_dialogue_user_label(SimpleNamespace(id=42, username=None)) == "42"
