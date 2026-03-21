from __future__ import annotations

from uuid import uuid4

from services.supabase.backend import SupabaseBackend, get_default_backend, utcnow_iso


class ConversationStore:
    def __init__(self, backend: SupabaseBackend | None = None) -> None:
        self.backend = backend or get_default_backend()

    def get_active_conversation(self, user_id: str) -> dict | None:
        rows = self.backend.select(
            "conversations",
            filters={"user_id": user_id, "status": "active"},
            order_by="created_at",
            ascending=False,
        )
        return rows[0] if rows else None

    def get_or_create_active_conversation(self, user_id: str) -> dict:
        existing = self.get_active_conversation(user_id)
        if existing:
            return existing

        now = utcnow_iso()
        return self.backend.insert(
            "conversations",
            {
                "id": str(uuid4()),
                "user_id": user_id,
                "title": None,
                "status": "active",
                "created_at": now,
                "updated_at": now,
                "last_message_at": now,
            },
        )

    def touch(self, conversation_id: str) -> None:
        now = utcnow_iso()
        self.backend.update(
            "conversations",
            filters={"id": conversation_id},
            values={"updated_at": now, "last_message_at": now},
        )

    def clear_active_conversation(self, user_id: str) -> None:
        self.backend.update(
            "conversations",
            filters={"user_id": user_id, "status": "active"},
            values={"status": "cleared", "updated_at": utcnow_iso()},
        )

