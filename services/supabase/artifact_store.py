from __future__ import annotations

import re
from pathlib import Path
from uuid import uuid4

import config

from services.supabase.backend import SupabaseBackend, get_default_backend, utcnow_iso
from services.supabase.config import get_supabase_settings
from services.supabase.storage import StorageBackend, get_default_storage_backend


_FILENAME_SAFE_RE = re.compile(r"[^A-Za-z0-9._-]+")


def sanitize_filename(filename: str | None, *, fallback: str = "artifact.bin") -> str:
    candidate = Path(filename or fallback).name.strip() or fallback
    sanitized = _FILENAME_SAFE_RE.sub("-", candidate).strip(".-")
    return sanitized or fallback


def artifact_kind_from_mime_type(mime_type: str) -> str:
    if mime_type.startswith("audio/"):
        return "assistant_audio"
    if mime_type.startswith("image/"):
        return "assistant_image"
    return "assistant_file"


class ArtifactStore:
    def __init__(
        self,
        metadata_backend: SupabaseBackend | None = None,
        storage_backend: StorageBackend | None = None,
    ) -> None:
        self.metadata_backend = metadata_backend or get_default_backend()
        self.storage_backend = storage_backend or get_default_storage_backend()
        if config.has_supabase_config():
            settings = get_supabase_settings()
            self.upload_bucket = settings.upload_bucket
            self.artifact_bucket = settings.artifact_bucket
        else:
            self.upload_bucket = "user-uploads"
            self.artifact_bucket = "assistant-artifacts"

    def _build_object_path(
        self,
        *,
        user_id: str,
        conversation_id: str | None,
        filename: str,
    ) -> tuple[str, str]:
        artifact_id = str(uuid4())
        safe_filename = sanitize_filename(filename)
        conversation_segment = conversation_id or "no-conversation"
        object_path = f"{user_id}/{conversation_segment}/{artifact_id}/{safe_filename}"
        return artifact_id, object_path

    def _insert_artifact_row(
        self,
        *,
        artifact_id: str,
        user_id: str,
        conversation_id: str | None,
        adk_session_row_id: str | None,
        bucket: str,
        object_path: str,
        filename: str,
        mime_type: str,
        artifact_kind: str,
        size_bytes: int,
        metadata: dict | None = None,
    ) -> dict:
        now = utcnow_iso()
        return self.metadata_backend.insert(
            "artifacts",
            {
                "id": artifact_id,
                "user_id": user_id,
                "conversation_id": conversation_id,
                "adk_session_row_id": adk_session_row_id,
                "bucket": bucket,
                "object_path": object_path,
                "filename": filename,
                "mime_type": mime_type,
                "artifact_kind": artifact_kind,
                "size_bytes": size_bytes,
                "metadata": metadata or {},
                "created_at": now,
                "updated_at": now,
            },
        )

    def store_user_upload(
        self,
        *,
        user_id: str,
        conversation_id: str | None,
        filename: str,
        mime_type: str,
        data: bytes,
        metadata: dict | None = None,
    ) -> dict:
        safe_filename = sanitize_filename(filename)
        artifact_id, object_path = self._build_object_path(
            user_id=user_id,
            conversation_id=conversation_id,
            filename=safe_filename,
        )
        self.storage_backend.upload(
            bucket=self.upload_bucket,
            object_path=object_path,
            data=data,
            content_type=mime_type,
        )
        return self._insert_artifact_row(
            artifact_id=artifact_id,
            user_id=user_id,
            conversation_id=conversation_id,
            adk_session_row_id=None,
            bucket=self.upload_bucket,
            object_path=object_path,
            filename=safe_filename,
            mime_type=mime_type,
            artifact_kind="upload",
            size_bytes=len(data),
            metadata=metadata,
        )

    def store_assistant_artifact(
        self,
        *,
        user_id: str,
        conversation_id: str | None,
        filename: str,
        mime_type: str,
        data: bytes,
        adk_session_row_id: str | None = None,
        metadata: dict | None = None,
    ) -> dict:
        safe_filename = sanitize_filename(filename)
        artifact_id, object_path = self._build_object_path(
            user_id=user_id,
            conversation_id=conversation_id,
            filename=safe_filename,
        )
        self.storage_backend.upload(
            bucket=self.artifact_bucket,
            object_path=object_path,
            data=data,
            content_type=mime_type,
        )
        return self._insert_artifact_row(
            artifact_id=artifact_id,
            user_id=user_id,
            conversation_id=conversation_id,
            adk_session_row_id=adk_session_row_id,
            bucket=self.artifact_bucket,
            object_path=object_path,
            filename=safe_filename,
            mime_type=mime_type,
            artifact_kind=artifact_kind_from_mime_type(mime_type),
            size_bytes=len(data),
            metadata=metadata,
        )

    def get_artifact(self, artifact_id: str) -> dict | None:
        rows = self.metadata_backend.select(
            "artifacts",
            filters={"id": artifact_id},
        )
        return rows[0] if rows else None

    def get_download_bytes(self, artifact_id: str) -> tuple[dict, bytes]:
        artifact = self.get_artifact(artifact_id)
        if artifact is None:
            raise KeyError(artifact_id)
        data = self.storage_backend.download(
            bucket=artifact["bucket"],
            object_path=artifact["object_path"],
        )
        return artifact, data

    def get_download_url(self, artifact: dict, *, expires_in: int = 3600) -> str:
        signed_url = self.storage_backend.create_signed_url(
            bucket=artifact["bucket"],
            object_path=artifact["object_path"],
            expires_in=expires_in,
        )
        if signed_url:
            return signed_url
        return f"/api/files/{artifact['id']}"
