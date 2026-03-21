from __future__ import annotations

from api.teacher_mode.models import LessonSessionState
from services.supabase.teacher_session_store import TeacherSessionStore


class SessionStateStore:
    def __init__(self, store: TeacherSessionStore | None = None):
        self._store = store or TeacherSessionStore()

    def get(self, session_id: str, user_id: str) -> LessonSessionState | None:
        return self._store.get(session_id, user_id)

    def save(self, state: LessonSessionState) -> LessonSessionState:
        return self._store.save(state)

    def delete(self, session_id: str, user_id: str) -> None:
        self._store.delete(session_id, user_id)
