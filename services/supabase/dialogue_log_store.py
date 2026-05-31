from __future__ import annotations

from uuid import uuid4

import config
from services.supabase.backend import (
    SupabaseBackend,
    get_default_backend,
    get_service_role_backend,
    utcnow_iso,
)


class DialogueLogStore:
    def __init__(self, backend: SupabaseBackend | None = None) -> None:
        if backend is not None:
            self.backend = backend
        elif config.has_supabase_service_role_config():
            self.backend = get_service_role_backend()
        else:
            self.backend = get_default_backend()

    def append_turn(
        self,
        *,
        log_path: str,
        source: str,
        user_id: str,
        user_label: str | None,
        user_text: str,
        assistant_text: str,
        logged_at: str,
    ) -> dict:
        return self.backend.insert(
            "dialogue_logs",
            {
                "id": str(uuid4()),
                "log_path": log_path,
                "source": source,
                "user_id": user_id,
                "user_label": user_label,
                "user_text": user_text,
                "assistant_text": assistant_text,
                "logged_at": logged_at,
                "created_at": utcnow_iso(),
            },
        )
