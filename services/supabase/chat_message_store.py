from __future__ import annotations

from uuid import uuid4

from services.supabase.backend import SupabaseBackend, get_default_backend, utcnow_iso


class ChatMessageStore:
    def __init__(self, backend: SupabaseBackend | None = None) -> None:
        self.backend = backend or get_default_backend()

    def append_message(
        self,
        conversation_id: str,
        user_id: str,
        role: str,
        content: str,
        *,
        content_type: str = "text",
        metadata: dict | None = None,
    ) -> dict:
        now = utcnow_iso()
        return self.backend.insert(
            "chat_messages",
            {
                "id": str(uuid4()),
                "conversation_id": conversation_id,
                "user_id": user_id,
                "role": role,
                "content": content,
                "content_type": content_type,
                "metadata": metadata or {},
                "created_at": now,
                "updated_at": now,
            },
        )

    def list_message_rows(self, conversation_id: str) -> list[dict]:
        return self.backend.select(
            "chat_messages",
            filters={"conversation_id": conversation_id},
            order_by="created_at",
            ascending=True,
        )

    def list_messages(self, conversation_id: str) -> list[dict]:
        return [
            {"role": row["role"], "content": row["content"]}
            for row in self.list_message_rows(conversation_id)
        ]

