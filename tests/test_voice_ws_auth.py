from __future__ import annotations

import inspect

import pytest
from fastapi.testclient import TestClient
from jwt import PyJWKClientError
from starlette.websockets import WebSocketDisconnect

import config
from app import app
from services.supabase.jwt_verifier import SupabaseJWTVerificationError


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

    async def get_or_create_session(self, user_id: str) -> str:
        self.session_users.append(user_id)
        return f"session-for-{user_id}"


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(config, "LOCAL_ASR", False)
    yield TestClient(app)


def test_socket_rejects_non_auth_traffic_before_auth(
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

    with client.websocket_connect("/api/voice") as websocket:
        websocket.send_json({"type": "interrupt"})
        assert websocket.receive_json() == {
            "type": "error",
            "message": "authentication required before voice messages",
        }
        with pytest.raises(WebSocketDisconnect) as exc:
            websocket.receive_json()

    assert exc.value.code == 4401


def test_first_valid_auth_message_establishes_authenticated_context(
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
    monkeypatch.setattr("api.voice.adk_service", fake_service)
    monkeypatch.setattr("api.voice.register_voice_user", lambda *args, **kwargs: None)
    monkeypatch.setattr("api.voice.unregister_voice_user", lambda *args, **kwargs: None)

    with client.websocket_connect("/api/voice") as websocket:
        websocket.send_json({"type": "auth", "access_token": "good-token"})
        first_message = websocket.receive_json()
        assert first_message["type"] == "voice_config"

        websocket.send_json({"type": "interrupt"})
        assert websocket.receive_json() == {"type": "interruption_handshake"}

    assert fake_service.session_users == ["auth-user-123"]


def test_voice_socket_reports_adk_service_unavailable_after_auth(
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
    monkeypatch.setattr("api.voice.adk_service", None)

    with client.websocket_connect("/api/voice") as websocket:
        websocket.send_json({"type": "auth", "access_token": "good-token"})
        assert websocket.receive_json() == {
            "type": "error",
            "message": "ADK service is unavailable",
        }
        with pytest.raises(WebSocketDisconnect) as exc:
            websocket.receive_json()

    assert exc.value.code == 1011


def test_simple_voice_handler_requires_authenticated_user_id() -> None:
    from api.voice_simple import handle_simple_voice

    signature = inspect.signature(handle_simple_voice)

    assert signature.parameters["user_id"].default is inspect.Parameter.empty


def test_invalid_token_closes_socket_deterministically(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "api.auth.get_jwt_verifier",
        lambda: FakeVerifier(error=SupabaseJWTVerificationError("invalid token")),
    )

    with client.websocket_connect("/api/voice") as websocket:
        websocket.send_json({"type": "auth", "access_token": "bad-token"})
        assert websocket.receive_json() == {
            "type": "error",
            "message": "invalid token",
        }
        with pytest.raises(WebSocketDisconnect) as exc:
            websocket.receive_json()

    assert exc.value.code == 4401


def test_jwks_client_error_closes_socket_deterministically(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "api.auth.get_jwt_verifier",
        lambda: FakeVerifier(error=PyJWKClientError("jwks lookup failed")),
    )

    with client.websocket_connect("/api/voice") as websocket:
        websocket.send_json({"type": "auth", "access_token": "bad-token"})
        assert websocket.receive_json() == {
            "type": "error",
            "message": "jwks lookup failed",
        }
        with pytest.raises(WebSocketDisconnect) as exc:
            websocket.receive_json()

    assert exc.value.code == 4401
