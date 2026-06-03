from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import config
from api import chat as chat_module
from app import app
from services.supabase.artifact_store import ArtifactStore
from services.supabase.backend import InMemorySupabaseBackend, reset_shared_memory_backend
from services.supabase.chat_message_store import ChatMessageStore
from services.supabase.conversation_store import ConversationStore
from services.supabase.jwt_verifier import SupabaseJWTVerificationError
from services.supabase.storage import InMemoryStorageBackend, reset_shared_memory_storage_backend


class FakeVerifier:
    def __init__(self, claims_by_token: dict[str, dict]) -> None:
        self.claims_by_token = claims_by_token

    def verify(self, access_token: str) -> dict:
        if access_token not in self.claims_by_token:
            raise SupabaseJWTVerificationError("token not recognized")
        return self.claims_by_token[access_token]


class FakeArtifactService:
    def __init__(self, *, data: bytes, mime_type: str) -> None:
        self.data = data
        self.mime_type = mime_type

    async def load_artifact(self, **kwargs):
        return SimpleNamespace(
            inline_data=SimpleNamespace(
                data=self.data,
                mime_type=self.mime_type,
            )
        )


class FakeADKService:
    def __init__(self) -> None:
        self.app_name = "router-agent"
        self.artifact_service = FakeArtifactService(
            data=b"assistant-wav",
            mime_type="audio/wav",
        )

    async def get_or_create_session(
        self,
        user_id: str,
        conversation_id: str | None = None,
    ) -> str:
        _ = user_id
        _ = conversation_id
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
        _ = session_id
        _ = user_id
        _ = text
        _ = file_data
        _ = mime_type
        return "assistant reply", {"assistant-response.wav": 1}, []


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def reset_shared_state() -> None:
    reset_shared_memory_backend()
    reset_shared_memory_storage_backend()
    chat_module.chat_histories.clear()


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(config, "LOCAL_ASR", False)
    yield TestClient(app)


def test_store_user_upload_creates_sanitized_metadata_row() -> None:
    metadata_backend = InMemorySupabaseBackend()
    storage_backend = InMemoryStorageBackend()
    artifact_store = ArtifactStore(metadata_backend, storage_backend)

    row = artifact_store.store_user_upload(
        user_id="auth-user-123",
        conversation_id="conversation-1",
        filename="../shared/lesson.wav",
        mime_type="audio/wav",
        data=b"upload-bytes",
    )

    assert row["artifact_kind"] == "upload"
    assert row["filename"] == "lesson.wav"
    assert ".." not in row["object_path"]
    assert storage_backend.download(
        bucket=row["bucket"],
        object_path=row["object_path"],
    ) == b"upload-bytes"


def test_store_assistant_artifact_creates_metadata_row() -> None:
    metadata_backend = InMemorySupabaseBackend()
    storage_backend = InMemoryStorageBackend()
    artifact_store = ArtifactStore(metadata_backend, storage_backend)

    row = artifact_store.store_assistant_artifact(
        user_id="auth-user-123",
        conversation_id="conversation-1",
        filename="response.png",
        mime_type="image/png",
        data=b"png-bytes",
    )

    assert row["artifact_kind"] == "assistant_image"
    assert row["filename"] == "response.png"
    assert storage_backend.download(
        bucket=row["bucket"],
        object_path=row["object_path"],
    ) == b"png-bytes"


def test_chat_upload_creates_artifact_rows_and_owner_can_read_artifact(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from api import deps as deps_module
    from api import files as files_module

    metadata_backend = InMemorySupabaseBackend()
    storage_backend = InMemoryStorageBackend()
    artifact_store = ArtifactStore(metadata_backend, storage_backend)
    conversation_store = ConversationStore(metadata_backend)
    chat_message_store = ChatMessageStore(metadata_backend)
    fake_service = FakeADKService()

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
    monkeypatch.setattr(chat_module, "adk_service", fake_service)
    monkeypatch.setattr(chat_module, "artifact_store", artifact_store)
    monkeypatch.setattr(chat_module, "conversation_store", conversation_store)
    monkeypatch.setattr(chat_module, "chat_message_store", chat_message_store)
    monkeypatch.setattr(deps_module, "artifact_store", artifact_store)
    monkeypatch.setattr(files_module, "artifact_store", artifact_store)

    response = client.post(
        "/api/chat",
        headers=auth_headers("good-token"),
        data={"text": "hello"},
        files={"files": ("../../upload.wav", b"upload-bytes", "audio/wav")},
    )

    assert response.status_code == 200
    assert response.json()["audio"].startswith("/api/files/")
    assert response.json()["artifacts"] == [
        {
            "kind": "audio",
            "filename": "assistant-response.wav",
            "mime_type": "audio/wav",
            "url": response.json()["audio"],
        }
    ]

    artifact_rows = metadata_backend.select(
        "artifacts",
        filters={"user_id": "auth-user-123"},
        order_by="created_at",
    )
    assert [row["artifact_kind"] for row in artifact_rows] == ["upload", "assistant_audio"]
    assert artifact_rows[0]["filename"] == "upload.wav"
    assert artifact_rows[1]["filename"] == "assistant-response.wav"

    download_response = client.get(
        f"/api/files/{artifact_rows[1]['id']}",
        headers=auth_headers("good-token"),
    )

    assert download_response.status_code == 200
    assert download_response.headers["content-type"].startswith("audio/wav")
    assert download_response.content == b"assistant-wav"


def test_file_endpoint_rejects_other_authenticated_users(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from api import files as files_module

    metadata_backend = InMemorySupabaseBackend()
    storage_backend = InMemoryStorageBackend()
    artifact_store = ArtifactStore(metadata_backend, storage_backend)
    artifact_row = artifact_store.store_assistant_artifact(
        user_id="owner-user",
        conversation_id="conversation-1",
        filename="private.wav",
        mime_type="audio/wav",
        data=b"private-bytes",
    )

    monkeypatch.setattr(
        "api.auth.get_jwt_verifier",
        lambda: FakeVerifier(
            {
                "other-token": {
                    "sub": "other-user",
                    "aud": "authenticated",
                    "iss": "https://project-ref.supabase.co/auth/v1",
                }
            }
        ),
    )
    monkeypatch.setattr(files_module, "artifact_store", artifact_store)

    response = client.get(
        f"/api/files/{artifact_row['id']}",
        headers=auth_headers("other-token"),
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Forbidden"
