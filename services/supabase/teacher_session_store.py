from __future__ import annotations

from uuid import uuid4

from api.teacher_mode.models import LessonSessionState
from services.supabase.backend import SupabaseBackend, get_default_backend, utcnow_iso


class TeacherSessionStore:
    def __init__(self, backend: SupabaseBackend | None = None) -> None:
        self.backend = backend or get_default_backend()

    def get(self, session_id: str, user_id: str) -> LessonSessionState | None:
        rows = self.backend.select(
            "teacher_sessions",
            filters={"session_id": session_id, "user_id": user_id},
            order_by="updated_at",
            ascending=False,
        )
        return LessonSessionState.model_validate(rows[0]) if rows else None

    def save(self, state: LessonSessionState) -> LessonSessionState:
        existing = self.get(state.session_id, state.user_id)
        payload = {
            "session_id": state.session_id,
            "user_id": state.user_id,
            "lesson_id": state.lesson_id,
            "current_step_id": state.current_step_id,
            "attempt_count": state.attempt_count,
            "mistakes_to_review": list(state.mistakes_to_review),
            "mode": state.mode,
            "lesson_status": state.lesson_status.value,
            "recent_turn_summary": state.recent_turn_summary,
            "updated_at": utcnow_iso(),
        }

        if existing:
            updated = self.backend.update(
                "teacher_sessions",
                filters={"session_id": state.session_id, "user_id": state.user_id},
                values=payload,
            )
            return LessonSessionState.model_validate(updated[0])

        now = payload["updated_at"]
        created = self.backend.insert(
            "teacher_sessions",
            {
                "id": str(uuid4()),
                **payload,
                "created_at": now,
            },
        )
        return LessonSessionState.model_validate(created)

    def delete(self, session_id: str, user_id: str) -> None:
        self.backend.delete("teacher_sessions", filters={"session_id": session_id, "user_id": user_id})
