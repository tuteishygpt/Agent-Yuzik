from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

import config
from app import app
from services.supabase.jwt_verifier import SupabaseJWTVerificationError


class FakeVerifier:
    def __init__(self, claims_by_token: dict[str, dict]) -> None:
        self.claims_by_token = claims_by_token

    def verify(self, access_token: str) -> dict:
        if access_token not in self.claims_by_token:
            raise SupabaseJWTVerificationError("token not recognized")
        return self.claims_by_token[access_token]


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_chat_history_survives_process_restart_through_store_abstraction() -> None:
    from services.supabase.backend import InMemorySupabaseBackend
    from services.supabase.chat_message_store import ChatMessageStore
    from services.supabase.conversation_store import ConversationStore

    backend = InMemorySupabaseBackend()

    first_conversation_store = ConversationStore(backend)
    first_message_store = ChatMessageStore(backend)
    conversation = first_conversation_store.get_or_create_active_conversation("auth-user-123")
    first_message_store.append_message(conversation["id"], "auth-user-123", "user", "hello")
    first_message_store.append_message(conversation["id"], "auth-user-123", "assistant", "hi there")

    second_conversation_store = ConversationStore(backend)
    second_message_store = ChatMessageStore(backend)
    reloaded_conversation = second_conversation_store.get_active_conversation("auth-user-123")

    assert reloaded_conversation is not None
    assert second_message_store.list_messages(reloaded_conversation["id"]) == [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "hi there"},
    ]


def test_adk_session_mapping_reloads_by_authenticated_user_id() -> None:
    from services.supabase.adk_session_store import ADKSessionStore
    from services.supabase.backend import InMemorySupabaseBackend

    backend = InMemorySupabaseBackend()

    first_store = ADKSessionStore(backend)
    first_store.set_active_session(
        user_id="auth-user-123",
        app_name="router-agent",
        adk_session_id="session-1",
        conversation_id="conversation-1",
    )

    second_store = ADKSessionStore(backend)

    assert second_store.get_active_session_id("auth-user-123", "router-agent") == "session-1"
    assert second_store.get_active_session_id("other-user", "router-agent") is None


def test_adk_service_reuses_persisted_session_mapping(monkeypatch: pytest.MonkeyPatch) -> None:
    from types import SimpleNamespace

    from services.adk_service import ADKService
    from services.supabase.adk_session_store import ADKSessionStore
    from services.supabase.backend import InMemorySupabaseBackend

    backend = InMemorySupabaseBackend()

    first_service = ADKService(session_store=ADKSessionStore(backend))

    async def create_first_session(*args, **kwargs):
        return SimpleNamespace(id="session-1")

    monkeypatch.setattr(first_service.session_service, "create_session", create_first_session)

    first_session_id = asyncio.run(first_service.get_or_create_session("auth-user-123"))

    second_service = ADKService(session_store=ADKSessionStore(backend))
    recreated_sessions: list[dict[str, str]] = []

    async def missing_session(*args, **kwargs):
        return None

    async def recreate_session(*args, **kwargs):
        recreated_sessions.append(kwargs)
        return SimpleNamespace(id=kwargs["session_id"])

    monkeypatch.setattr(second_service.session_service, "get_session", missing_session)
    monkeypatch.setattr(second_service.session_service, "create_session", recreate_session)

    second_session_id = asyncio.run(second_service.get_or_create_session("auth-user-123"))

    assert first_session_id == "session-1"
    assert second_session_id == "session-1"
    assert recreated_sessions == [
        {
            "app_name": second_service.app_name,
            "user_id": "auth-user-123",
            "session_id": "session-1",
        }
    ]


def test_adk_service_uses_database_session_service_by_default(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    from google.adk.sessions import DatabaseSessionService

    import config
    from services.adk_service import ADKService
    from services.supabase.adk_session_store import ADKSessionStore
    from services.supabase.backend import InMemorySupabaseBackend

    db_path = tmp_path / "adk_sessions.db"
    monkeypatch.setattr(
        config,
        "ADK_SESSION_DB_URL",
        f"sqlite+aiosqlite:///{db_path.as_posix()}",
        raising=False,
    )

    service = ADKService(session_store=ADKSessionStore(InMemorySupabaseBackend()))

    assert isinstance(service.session_service, DatabaseSessionService)


def test_adk_service_clear_chat_context_resets_user_previous_state() -> None:
    from google.adk.sessions import InMemorySessionService

    from services.adk_service import ADKService
    from services.supabase.adk_session_store import ADKSessionStore
    from services.supabase.backend import InMemorySupabaseBackend

    service = ADKService(
        session_store=ADKSessionStore(InMemorySupabaseBackend()),
        session_service=InMemorySessionService(),
    )

    async def exercise() -> dict:
        await service.session_service.create_session(
            app_name=service.app_name,
            user_id="auth-user-123",
            state={
                "user:last_assistant_text": "old forecast",
                "user:last_assistant_summary": "old summary",
                "user:last_assistant_artifact_id": "artifact-1",
                "user:pending_text_action": {"kind": "translate"},
                "user:tts_requested_for_turn": True,
                "user:timezone": "Europe/Minsk",
            },
        )

        await service.clear_chat_context_state("auth-user-123")

        return await service.session_service.get_user_state(
            app_name=service.app_name,
            user_id="auth-user-123",
        )

    user_state = asyncio.run(exercise())

    assert user_state["last_assistant_text"] is None
    assert user_state["last_assistant_summary"] is None
    assert user_state["last_assistant_artifact_id"] is None
    assert user_state["pending_text_action"] is None
    assert user_state["tts_requested_for_turn"] is False
    assert user_state["timezone"] == "Europe/Minsk"


def test_history_endpoint_returns_only_authenticated_users_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from api import chat as chat_module
    from services.supabase.backend import InMemorySupabaseBackend
    from services.supabase.chat_message_store import ChatMessageStore
    from services.supabase.conversation_store import ConversationStore

    backend = InMemorySupabaseBackend()
    conversation_store = ConversationStore(backend)
    chat_message_store = ChatMessageStore(backend)

    own_conversation = conversation_store.get_or_create_active_conversation("auth-user-123")
    other_conversation = conversation_store.get_or_create_active_conversation("other-user")
    chat_message_store.append_message(own_conversation["id"], "auth-user-123", "assistant", "keep")
    chat_message_store.append_message(other_conversation["id"], "other-user", "assistant", "hide")

    monkeypatch.setattr(config, "LOCAL_ASR", False)
    monkeypatch.setattr(
        "api.auth.get_jwt_verifier",
        lambda: FakeVerifier(
            {
                "good-token": {
                    "sub": "auth-user-123",
                    "aud": "authenticated",
                    "iss": "https://project-ref.supabase.co/auth/v1",
                }
            }
        ),
    )
    monkeypatch.setattr(chat_module, "conversation_store", conversation_store)
    monkeypatch.setattr(chat_module, "chat_message_store", chat_message_store)

    with TestClient(app) as client:
        response = client.get(
            "/api/chat/history?user_id=other-user",
            headers=auth_headers("good-token"),
        )

    assert response.status_code == 200
    assert response.json() == {"history": [{"role": "assistant", "content": "keep"}]}


def test_clear_chat_history_marks_conversation_cleared_and_returns_empty_history(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from api import chat as chat_module
    from services.supabase.adk_session_store import ADKSessionStore
    from services.supabase.backend import InMemorySupabaseBackend
    from services.supabase.chat_message_store import ChatMessageStore
    from services.supabase.conversation_store import ConversationStore

    backend = InMemorySupabaseBackend()
    conversation_store = ConversationStore(backend)
    chat_message_store = ChatMessageStore(backend)
    adk_session_store = ADKSessionStore(backend)

    conversation = conversation_store.get_or_create_active_conversation("auth-user-123")
    chat_message_store.append_message(conversation["id"], "auth-user-123", "assistant", "keep")
    adk_session_store.set_active_session(
        user_id="auth-user-123",
        app_name=chat_module.adk_service.app_name,
        adk_session_id="session-with-previous-state",
        conversation_id=conversation["id"],
    )

    monkeypatch.setattr(config, "LOCAL_ASR", False)
    monkeypatch.setattr(
        "api.auth.get_jwt_verifier",
        lambda: FakeVerifier(
            {
                "good-token": {
                    "sub": "auth-user-123",
                    "aud": "authenticated",
                    "iss": "https://project-ref.supabase.co/auth/v1",
                }
            }
        ),
    )
    monkeypatch.setattr(chat_module, "conversation_store", conversation_store)
    monkeypatch.setattr(chat_module, "chat_message_store", chat_message_store)
    monkeypatch.setattr(chat_module, "adk_session_store", adk_session_store)

    with TestClient(app) as client:
        delete_response = client.delete(
            "/api/chat/history",
            headers=auth_headers("good-token"),
        )
        get_response = client.get(
            "/api/chat/history",
            headers=auth_headers("good-token"),
        )

    assert delete_response.status_code == 200
    assert delete_response.json() == {"status": "ok"}
    assert get_response.status_code == 200
    assert get_response.json() == {"history": []}
    assert conversation_store.get_active_conversation("auth-user-123") is None
    assert (
        adk_session_store.get_active_session(
            "auth-user-123",
            chat_module.adk_service.app_name,
        )
        is None
    )
    assert backend.tables["adk_sessions"][0]["status"] == "closed"


def test_chat_dialogue_log_uses_authenticated_email_when_available(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    from api import chat as chat_module
    from services.supabase.backend import InMemorySupabaseBackend
    from services.supabase.chat_message_store import ChatMessageStore
    from services.supabase.conversation_store import ConversationStore

    class FakeADKService:
        async def get_or_create_session(self, user_id: str, conversation_id: str | None = None) -> str:
            return "session-1"

        def run_agent(self, **kwargs):
            return "reply text", {}, []

    backend = InMemorySupabaseBackend()
    log_path = tmp_path / "chat_dialogues.txt"

    monkeypatch.setattr(config, "LOCAL_ASR", False)
    monkeypatch.setattr(config, "CHAT_DIALOGUE_LOG_PATH", str(log_path))
    monkeypatch.setattr(
        "api.auth.get_jwt_verifier",
        lambda: FakeVerifier(
            {
                "good-token": {
                    "sub": "auth-user-123",
                    "email": "person@example.com",
                    "aud": "authenticated",
                    "iss": "https://project-ref.supabase.co/auth/v1",
                }
            }
        ),
    )
    monkeypatch.setattr(chat_module, "conversation_store", ConversationStore(backend))
    monkeypatch.setattr(chat_module, "chat_message_store", ChatMessageStore(backend))
    monkeypatch.setattr(chat_module, "adk_service", FakeADKService())

    with TestClient(app) as client:
        response = client.post(
            "/api/chat",
            data={"text": "hello"},
            headers=auth_headers("good-token"),
        )

    assert response.status_code == 200
    assert "[20" in log_path.read_text(encoding="utf-8")
    assert "USER (person@example.com): hello\n" in log_path.read_text(encoding="utf-8")


def test_chat_endpoint_returns_no_answer_text_when_agent_output_is_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from api import chat as chat_module
    from services.supabase.backend import InMemorySupabaseBackend
    from services.supabase.chat_message_store import ChatMessageStore
    from services.supabase.conversation_store import ConversationStore

    class EmptyADKService:
        async def get_or_create_session(
            self,
            user_id: str,
            conversation_id: str | None = None,
        ) -> str:
            _ = user_id
            _ = conversation_id
            return "session-1"

        def run_agent(self, **kwargs):
            _ = kwargs
            return "", {}, []

    backend = InMemorySupabaseBackend()

    monkeypatch.setattr(config, "LOCAL_ASR", False)
    monkeypatch.setattr(
        "api.auth.get_jwt_verifier",
        lambda: FakeVerifier(
            {
                "good-token": {
                    "sub": "auth-user-123",
                    "aud": "authenticated",
                    "iss": "https://project-ref.supabase.co/auth/v1",
                }
            }
        ),
    )
    monkeypatch.setattr(chat_module, "conversation_store", ConversationStore(backend))
    monkeypatch.setattr(chat_module, "chat_message_store", ChatMessageStore(backend))
    monkeypatch.setattr(chat_module, "adk_service", EmptyADKService())

    with TestClient(app) as client:
        response = client.post(
            "/api/chat",
            data={"text": "hello"},
            headers=auth_headers("good-token"),
        )

    assert response.status_code == 200
    assert response.json()["text"] == config.DEFAULT_NO_ANSWER
    conversation = chat_module.conversation_store.get_active_conversation("auth-user-123")
    assert conversation is not None
    assert chat_module.chat_message_store.list_messages(conversation["id"]) == [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": config.DEFAULT_NO_ANSWER},
    ]
