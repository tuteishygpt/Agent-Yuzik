from __future__ import annotations

import logging

from api.teacher_mode.models import TeacherTurnOutcome

log = logging.getLogger("app.voice.teacher")


def log_teacher_turn(
    *,
    user_id: str,
    session_id: str,
    lesson_id: str,
    outcome: TeacherTurnOutcome,
    error_tags: list[str],
    latency_ms: int,
) -> None:
    log.info(
        "teacher_turn user=%s session=%s lesson=%s step=%s status=%s action=%s latency_ms=%s "
        "transcript=%r normalized=%r error_tags=%s fallback=%s reply=%r",
        user_id,
        session_id,
        lesson_id,
        outcome.step_id,
        outcome.answer_status.value,
        outcome.teacher_action.value,
        latency_ms,
        outcome.transcript,
        outcome.normalized_transcript,
        error_tags,
        outcome.fallback_reason,
        outcome.reply_text,
    )
