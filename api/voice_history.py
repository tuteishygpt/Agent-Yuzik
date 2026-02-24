# api/voice_history.py
"""
Модуль захавання гісторыі дыялогу для галасавога рэжыму.

Захоўвае пары "пытанне карыстальніка → адказ асістэнта" у памяці
для кожнага карыстальніка, каб LLM (Gemini) мела кантэкст
папярэдняй размовы.

REST-эндпойнты:
  GET    /api/voice/history?user_id=...  — атрымаць гісторыю
  DELETE /api/voice/history?user_id=...  — ачысціць гісторыю
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional

from fastapi import APIRouter
from google.genai import types

log = logging.getLogger("app.voice")

# ─── Configuration ──────────────────────────────────────────────────

# Maximum number of dialog turns to keep per user.
# One turn = user message + assistant reply.
MAX_VOICE_HISTORY_TURNS = 20

# Maximum total characters across all history entries (safety guard).
MAX_VOICE_HISTORY_CHARS = 8_000

# ─── Data structures ────────────────────────────────────────────────


@dataclass
class VoiceTurn:
    """Single turn in a voice conversation."""
    user_text: str               # Transcription or description of user audio
    assistant_text: str          # Full text response from LLM
    timestamp: float = field(default_factory=time.time)

    def total_chars(self) -> int:
        return len(self.user_text) + len(self.assistant_text)


class VoiceHistory:
    """
    In-memory voice conversation history for a single user.

    Thread-safe for async usage (single event loop).
    """

    def __init__(
        self,
        max_turns: int = MAX_VOICE_HISTORY_TURNS,
        max_chars: int = MAX_VOICE_HISTORY_CHARS,
    ):
        self._turns: List[VoiceTurn] = []
        self._max_turns = max_turns
        self._max_chars = max_chars

    # ── Mutators ──

    def add_turn(self, user_text: str, assistant_text: str) -> None:
        """Add a completed dialog turn and trim if over limits."""
        turn = VoiceTurn(user_text=user_text, assistant_text=assistant_text)
        self._turns.append(turn)
        self._trim()
        log.debug(
            f"Voice history: added turn ({len(user_text)}+{len(assistant_text)} chars), "
            f"total turns={len(self._turns)}"
        )

    def clear(self) -> None:
        """Clear all history."""
        count = len(self._turns)
        self._turns.clear()
        log.info(f"Voice history: cleared {count} turns")

    # ── Accessors ──

    @property
    def turns(self) -> List[VoiceTurn]:
        return list(self._turns)

    @property
    def turn_count(self) -> int:
        return len(self._turns)

    def is_empty(self) -> bool:
        return len(self._turns) == 0

    def to_gemini_contents(self) -> List[types.Content]:
        """
        Convert history into a list of Gemini `types.Content` objects
        suitable for multi-turn conversation.

        Returns alternating user/model messages:
          [Content(role="user", ...), Content(role="model", ...), ...]
        """
        contents: List[types.Content] = []
        for turn in self._turns:
            # User turn (text representation of what they said)
            contents.append(
                types.Content(
                    role="user",
                    parts=[types.Part(text=turn.user_text)],
                )
            )
            # Model turn
            contents.append(
                types.Content(
                    role="model",
                    parts=[types.Part(text=turn.assistant_text)],
                )
            )
        return contents

    def to_dicts(self) -> List[Dict]:
        """Serialize history for REST API response."""
        return [asdict(t) for t in self._turns]

    # ── Internal ──

    def _trim(self) -> None:
        """Trim oldest turns to stay within limits."""
        # Trim by turn count
        while len(self._turns) > self._max_turns:
            removed = self._turns.pop(0)
            log.debug(f"Voice history: trimmed oldest turn ({removed.total_chars()} chars)")

        # Trim by total characters
        while self._total_chars() > self._max_chars and len(self._turns) > 1:
            removed = self._turns.pop(0)
            log.debug(
                f"Voice history: trimmed for char limit "
                f"({removed.total_chars()} chars removed)"
            )

    def _total_chars(self) -> int:
        return sum(t.total_chars() for t in self._turns)


# ─── Global registry ────────────────────────────────────────────────

_voice_histories: Dict[str, VoiceHistory] = {}


def get_voice_history(user_id: str) -> VoiceHistory:
    """Get or create voice history for a user."""
    if user_id not in _voice_histories:
        _voice_histories[user_id] = VoiceHistory()
        log.info(f"Voice history: created new history for user '{user_id}'")
    return _voice_histories[user_id]


def clear_voice_history(user_id: str) -> None:
    """Clear voice history for a specific user."""
    if user_id in _voice_histories:
        _voice_histories[user_id].clear()


def clear_all_voice_histories() -> None:
    """Clear voice histories for all users."""
    for h in _voice_histories.values():
        h.clear()
    _voice_histories.clear()
    log.info("Voice history: all histories cleared")


# ─── REST API ────────────────────────────────────────────────────────

router = APIRouter(prefix="/api/voice", tags=["voice-history"])


@router.get("/history")
async def api_get_voice_history(user_id: str = "voice_user"):
    """Атрымаць гісторыю галасавога дыялогу для карыстальніка."""
    history = get_voice_history(user_id)
    return {
        "user_id": user_id,
        "turn_count": history.turn_count,
        "history": history.to_dicts(),
    }


@router.delete("/history")
async def api_clear_voice_history(user_id: str = "voice_user"):
    """Ачысціць гісторыю галасавога дыялогу для карыстальніка."""
    clear_voice_history(user_id)
    return {"status": "ok", "user_id": user_id}
