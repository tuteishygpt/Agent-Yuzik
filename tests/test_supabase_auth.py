from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient
from jwt import PyJWKClientError

import config
from api import chat as chat_module
from api import voice_history as voice_history_module
from app import app
from services.supabase.backend import reset_shared_memory_backend
from services.supabase.jwt_verifier import SupabaseJWTVerificationError, SupabaseJWTVerifier


class FakeVerifier:
    def __init__(self, *, claims_by_token: dict[str, dict] | None = None, error: Exception | None = None):
        self.claims_by_token = claims_by_token or {}
        self.error = error

    def verify(self, access_token: str) -> dict:
        if self.error is not None:
            raise self.error
        if access_token not in self.claims_by_token:
            raise SupabaseJWTVerificationError("token not recognized")
        return self.claims_by_token[access_token]


class FakeADKService:
    def __init__(self) -> None:
        self.session_users: list[str] = []
        self.run_calls: list[dict[str, object]] = []

    async def get_or_create_session(
        self,
        user_id: str,
        conversation_id: str | None = None,
    ) -> str:
        self.session_users.append(user_id)
        return f"session-for-{user_id}"

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
        return "assistant reply", {}, []


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(config, "LOCAL_ASR", False)
    yield TestClient(app)


@pytest.fixture(autouse=True)
def clear_in_memory_state() -> None:
    reset_shared_memory_backend()
    chat_module.chat_histories.clear()
    voice_history_module.clear_all_voice_histories()


def test_missing_bearer_token_is_rejected(client: TestClient) -> None:
    response = client.get("/api/chat/history")

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing bearer token"


def test_invalid_jwt_is_rejected(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "api.auth.get_jwt_verifier",
        lambda: FakeVerifier(error=SupabaseJWTVerificationError("invalid token")),
    )

    response = client.get("/api/chat/history", headers=auth_headers("bad-token"))

    assert response.status_code == 401
    assert response.json()["detail"] == "invalid token"


def test_jwks_client_error_is_rejected(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "api.auth.get_jwt_verifier",
        lambda: FakeVerifier(error=PyJWKClientError("jwks lookup failed")),
    )

    response = client.get("/api/chat/history", headers=auth_headers("bad-token"))

    assert response.status_code == 401
    assert response.json()["detail"] == "jwks lookup failed"


def test_chat_endpoint_ignores_client_supplied_user_id(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_service = FakeADKService()
    monkeypatch.setattr(
        "api.auth.get_jwt_verifier",
        lambda: FakeVerifier(
            claims_by_token={
                "good-token": {
                    "sub": "auth-user-123",
                    "aud": "authenticated",
                    "iss": "https://project-ref.supabase.co/auth/v1",
                }
            }
        ),
    )
    monkeypatch.setattr(chat_module, "adk_service", fake_service)

    response = client.post(
        "/api/chat",
        headers=auth_headers("good-token"),
        data={"text": "hello", "user_id": "malicious-user"},
    )

    assert response.status_code == 200
    assert fake_service.session_users == ["auth-user-123"]
    assert fake_service.run_calls[0]["user_id"] == "auth-user-123"
    assert chat_module.conversation_store.get_active_conversation("malicious-user") is None
    conversation = chat_module.conversation_store.get_active_conversation("auth-user-123")
    assert conversation is not None
    assert chat_module.chat_message_store.list_messages(conversation["id"]) == [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "assistant reply"},
    ]


def test_history_endpoints_return_only_authenticated_user_rows(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "api.auth.get_jwt_verifier",
        lambda: FakeVerifier(
            claims_by_token={
                "good-token": {
                    "sub": "auth-user-123",
                    "aud": "authenticated",
                    "iss": "https://project-ref.supabase.co/auth/v1",
                }
            }
        ),
    )
    auth_conversation = chat_module.conversation_store.get_or_create_active_conversation("auth-user-123")
    other_conversation = chat_module.conversation_store.get_or_create_active_conversation("other-user")
    chat_module.chat_message_store.append_message(
        auth_conversation["id"],
        "auth-user-123",
        "assistant",
        "keep",
    )
    chat_module.chat_message_store.append_message(
        other_conversation["id"],
        "other-user",
        "assistant",
        "hide",
    )
    voice_history_module.get_voice_history("auth-user-123").add_turn("u1", "a1")
    voice_history_module.get_voice_history("other-user").add_turn("u2", "a2")

    chat_response = client.get(
        "/api/chat/history?user_id=other-user",
        headers=auth_headers("good-token"),
    )
    voice_response = client.get(
        "/api/voice/history?user_id=other-user",
        headers=auth_headers("good-token"),
    )

    assert chat_response.status_code == 200
    assert chat_response.json() == {"history": [{"role": "assistant", "content": "keep"}]}
    assert voice_response.status_code == 200
    assert voice_response.json()["user_id"] == "auth-user-123"
    assert voice_response.json()["turn_count"] == 1
    assert voice_response.json()["history"][0]["user_text"] == "u1"


def test_verifier_wraps_jwks_key_selection_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    verifier = SupabaseJWTVerifier(
        issuer="https://project-ref.supabase.co/auth/v1",
        audience="authenticated",
        jwks_url="https://project-ref.supabase.co/auth/v1/.well-known/jwks.json",
    )

    def raise_jwks_error(access_token: str) -> None:
        raise PyJWKClientError(f"no signing key for {access_token}")

    monkeypatch.setattr(verifier._jwks_client, "get_signing_key_from_jwt", raise_jwks_error)

    with pytest.raises(SupabaseJWTVerificationError, match="no signing key for bad-token"):
        verifier.verify("bad-token")
