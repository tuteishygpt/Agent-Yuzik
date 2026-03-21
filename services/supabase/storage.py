from __future__ import annotations

from copy import deepcopy
from typing import Protocol

import config

from services.supabase.client import get_service_role_client


class StorageBackend(Protocol):
    def upload(self, *, bucket: str, object_path: str, data: bytes, content_type: str) -> None:
        ...

    def download(self, *, bucket: str, object_path: str) -> bytes:
        ...

    def create_signed_url(
        self,
        *,
        bucket: str,
        object_path: str,
        expires_in: int = 3600,
    ) -> str | None:
        ...


class InMemoryStorageBackend:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], dict[str, object]] = {}

    def upload(self, *, bucket: str, object_path: str, data: bytes, content_type: str) -> None:
        self.objects[(bucket, object_path)] = {
            "data": bytes(data),
            "content_type": content_type,
        }

    def download(self, *, bucket: str, object_path: str) -> bytes:
        return bytes(self.objects[(bucket, object_path)]["data"])

    def create_signed_url(
        self,
        *,
        bucket: str,
        object_path: str,
        expires_in: int = 3600,
    ) -> str | None:
        _ = expires_in
        return None


class SupabaseStorageBackend:
    def __init__(self, client) -> None:
        self.client = client

    def upload(self, *, bucket: str, object_path: str, data: bytes, content_type: str) -> None:
        self.client.storage.from_(bucket).upload(
            object_path,
            data,
            {"content-type": content_type, "upsert": "false"},
        )

    def download(self, *, bucket: str, object_path: str) -> bytes:
        return self.client.storage.from_(bucket).download(object_path)

    def create_signed_url(
        self,
        *,
        bucket: str,
        object_path: str,
        expires_in: int = 3600,
    ) -> str | None:
        return self.client.storage.from_(bucket).create_signed_url(
            object_path,
            expires_in,
        )["signedURL"]


_shared_memory_storage_backend = InMemoryStorageBackend()


def get_default_storage_backend() -> StorageBackend:
    if config.has_supabase_config():
        return SupabaseStorageBackend(get_service_role_client())
    return _shared_memory_storage_backend


def reset_shared_memory_storage_backend() -> None:
    _shared_memory_storage_backend.objects.clear()
