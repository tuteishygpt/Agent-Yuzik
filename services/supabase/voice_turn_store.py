from __future__ import annotations

from dataclasses import dataclass
from time import time
from uuid import uuid4

from services.supabase.backend import SupabaseBackend, get_default_backend, utcnow_iso

TIMESTAMP_COLUMN = "timestamp"


@dataclass(frozen=True)
class VoiceTurnRow:
    user_text: str
    assistant_text: str
    timestamp: float


class VoiceTurnStore:
    def __init__(self, backend: SupabaseBackend | None = None) -> None:
        self.backend = backend or get_default_backend()

    def append_turn(
        self,
        *,
        user_id: str,
        user_text: str,
        assistant_text: str,
        timestamp: float | None = None,
    ) -> dict:
        ts = timestamp if timestamp is not None else time()
        return self.backend.insert(
            "voice_turns",
            {
                "id": str(uuid4()),
                "user_id": user_id,
                "user_text": user_text,
                "assistant_text": assistant_text,
                "timestamp": ts,
                "created_at": utcnow_iso(),
                "updated_at": utcnow_iso(),
            },
        )

    def list_turn_rows(self, user_id: str) -> list[dict]:
        return self.backend.select(
            "voice_turns",
            filters={"user_id": user_id},
            order_by=TIMESTAMP_COLUMN,
            ascending=True,
        )

    def list_turns(self, user_id: str) -> list[VoiceTurnRow]:
        return [
            VoiceTurnRow(
                user_text=row["user_text"],
                assistant_text=row["assistant_text"],
                timestamp=float(row["timestamp"]),
            )
            for row in self.list_turn_rows(user_id)
        ]

    def clear_turns(self, user_id: str) -> None:
        self.backend.delete("voice_turns", filters={"user_id": user_id})

    def clear_all_turns(self) -> None:
        self.backend.delete("voice_turns")
