from __future__ import annotations

from typing import Dict, Tuple

from api.teacher_mode.models import LessonSessionState


class SessionStateStore:
    def __init__(self):
        self._store: Dict[Tuple[str, str], LessonSessionState] = {}

    def _key(self, session_id: str, user_id: str) -> Tuple[str, str]:
        return session_id, user_id

    def get(self, session_id: str, user_id: str) -> LessonSessionState | None:
        return self._store.get(self._key(session_id, user_id))

    def save(self, state: LessonSessionState) -> LessonSessionState:
        self._store[self._key(state.session_id, state.user_id)] = state
        return state

    def delete(self, session_id: str, user_id: str) -> None:
        self._store.pop(self._key(session_id, user_id), None)
