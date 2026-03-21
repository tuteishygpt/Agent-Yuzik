from __future__ import annotations

from uuid import uuid4

from services.supabase.backend import SupabaseBackend, get_default_backend, utcnow_iso


class ADKSessionStore:
    def __init__(self, backend: SupabaseBackend | None = None) -> None:
        self.backend = backend or get_default_backend()

    def get_active_session(self, user_id: str, app_name: str) -> dict | None:
        rows = self.backend.select(
            "adk_sessions",
            filters={"user_id": user_id, "adk_app_name": app_name, "status": "active"},
            order_by="last_used_at",
            ascending=False,
        )
        return rows[0] if rows else None

    def get_active_session_id(self, user_id: str, app_name: str) -> str | None:
        row = self.get_active_session(user_id, app_name)
        return row["adk_session_id"] if row else None

    def set_active_session(
        self,
        *,
        user_id: str,
        app_name: str,
        adk_session_id: str,
        conversation_id: str | None,
    ) -> dict:
        now = utcnow_iso()
        existing = self.get_active_session(user_id, app_name)
        if existing:
            updated = self.backend.update(
                "adk_sessions",
                filters={"id": existing["id"]},
                values={
                    "conversation_id": conversation_id,
                    "adk_session_id": adk_session_id,
                    "updated_at": now,
                    "last_used_at": now,
                },
            )
            return updated[0]

        return self.backend.insert(
            "adk_sessions",
            {
                "id": str(uuid4()),
                "user_id": user_id,
                "conversation_id": conversation_id,
                "adk_app_name": app_name,
                "adk_session_id": adk_session_id,
                "status": "active",
                "created_at": now,
                "updated_at": now,
                "last_used_at": now,
            },
        )
