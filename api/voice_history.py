from __future__ import annotations

import logging
from dataclasses import asdict, dataclass, field
from time import time
from typing import List

from fastapi import APIRouter, Depends
from google.genai import types

from api.auth import AuthenticatedUser, get_current_user
from services.supabase.backend import get_default_backend
from services.supabase.voice_turn_store import VoiceTurnStore

log = logging.getLogger("app.voice")

MAX_VOICE_HISTORY_TURNS = 20
MAX_VOICE_HISTORY_CHARS = 8_000


@dataclass
class VoiceTurn:
    user_text: str
    assistant_text: str
    timestamp: float = field(default_factory=time)

    def total_chars(self) -> int:
        return len(self.user_text) + len(self.assistant_text)


class VoiceHistory:
    def __init__(
        self,
        user_id: str,
        *,
        store: VoiceTurnStore | None = None,
        max_turns: int = MAX_VOICE_HISTORY_TURNS,
        max_chars: int = MAX_VOICE_HISTORY_CHARS,
    ) -> None:
        self.user_id = user_id
        self._store = store or voice_turn_store
        self._max_turns = max_turns
        self._max_chars = max_chars

    def add_turn(self, user_text: str, assistant_text: str) -> None:
        self._store.append_turn(
            user_id=self.user_id,
            user_text=user_text,
            assistant_text=assistant_text,
            timestamp=time(),
        )
        self._trim_persisted_history()
        log.debug(
            "Voice history: added turn (%s+%s chars) for %s",
            len(user_text),
            len(assistant_text),
            self.user_id,
        )

    def clear(self) -> None:
        self._store.clear_turns(self.user_id)
        log.info("Voice history: cleared for user %s", self.user_id)

    @property
    def turns(self) -> List[VoiceTurn]:
        return self._load_trimmed_turns()

    @property
    def turn_count(self) -> int:
        return len(self.turns)

    def is_empty(self) -> bool:
        return not self.turns

    def to_gemini_contents(self) -> List[types.Content]:
        contents: List[types.Content] = []
        for turn in self.turns:
            contents.append(
                types.Content(
                    role="user",
                    parts=[types.Part(text=turn.user_text)],
                )
            )
            contents.append(
                types.Content(
                    role="model",
                    parts=[types.Part(text=turn.assistant_text)],
                )
            )
        return contents

    def to_dicts(self) -> List[dict]:
        return [asdict(turn) for turn in self.turns]

    def _load_trimmed_turns(self) -> List[VoiceTurn]:
        turns = [
            VoiceTurn(
                user_text=row.user_text,
                assistant_text=row.assistant_text,
                timestamp=row.timestamp,
            )
            for row in self._store.list_turns(self.user_id)
        ]
        return self._trim_turns(turns)

    def _trim_turns(self, turns: List[VoiceTurn]) -> List[VoiceTurn]:
        trimmed = list(turns[-self._max_turns :])
        while len(trimmed) > 1 and sum(turn.total_chars() for turn in trimmed) > self._max_chars:
            trimmed.pop(0)
        return trimmed

    def _trim_persisted_history(self) -> None:
        rows = self._store.list_turn_rows(self.user_id)
        if len(rows) <= self._max_turns and self._total_chars(rows) <= self._max_chars:
            return

        kept_rows = rows[-self._max_turns :]
        while len(kept_rows) > 1 and self._total_chars(kept_rows) > self._max_chars:
            kept_rows.pop(0)

        kept_ids = {
            row["id"]
            for row in kept_rows
            if "id" in row
        }
        for row in rows:
            if row.get("id") not in kept_ids:
                self._store.backend.delete("voice_turns", filters={"id": row.get("id")})

    @staticmethod
    def _total_chars(rows: List[dict]) -> int:
        return sum(len(row.get("user_text", "")) + len(row.get("assistant_text", "")) for row in rows)


voice_turn_store = VoiceTurnStore(get_default_backend())


def get_voice_history(user_id: str) -> VoiceHistory:
    return VoiceHistory(user_id, store=voice_turn_store)


def clear_voice_history(user_id: str) -> None:
    voice_turn_store.clear_turns(user_id)


def clear_all_voice_histories() -> None:
    voice_turn_store.clear_all_turns()
    log.info("Voice history: all histories cleared")


router = APIRouter(prefix="/api/voice", tags=["voice-history"])


@router.get("/history")
async def api_get_voice_history(
    user_id: str | None = None,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    _ = user_id
    history = get_voice_history(current_user.user_id)
    return {
        "user_id": current_user.user_id,
        "turn_count": history.turn_count,
        "history": history.to_dicts(),
    }


@router.delete("/history")
async def api_clear_voice_history(
    user_id: str | None = None,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    _ = user_id
    clear_voice_history(current_user.user_id)
    return {"status": "ok", "user_id": current_user.user_id}
