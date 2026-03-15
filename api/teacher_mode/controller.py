from __future__ import annotations

import time

from api.teacher_mode.analytics import log_teacher_turn
from api.teacher_mode.gemini_adapter import GeminiTeacherAdapter
from api.teacher_mode.lesson_store import LessonStore
from api.teacher_mode.models import (
    LessonSessionState,
    LessonStatus,
    TeacherAction,
    TeacherTurnOutcome,
)
from api.teacher_mode.session_store import SessionStateStore


class TeacherController:
    def __init__(
        self,
        lesson_store: LessonStore,
        session_store: SessionStateStore,
        adapter: GeminiTeacherAdapter,
    ):
        self.lesson_store = lesson_store
        self.session_store = session_store
        self.adapter = adapter

    def start_lesson(self, *, session_id: str, user_id: str, lesson_id: str) -> LessonSessionState:
        lesson = self.lesson_store.get_lesson(lesson_id)
        first_step = lesson.steps[0]
        state = LessonSessionState(
            session_id=session_id,
            user_id=user_id,
            lesson_id=lesson_id,
            current_step_id=first_step.step_id,
            attempt_count=0,
            lesson_status=LessonStatus.active,
            mode="teacher",
        )
        return self.session_store.save(state)

    def stop_lesson(self, *, session_id: str, user_id: str) -> None:
        self.session_store.delete(session_id, user_id)

    def get_state(self, *, session_id: str, user_id: str) -> LessonSessionState | None:
        return self.session_store.get(session_id, user_id)

    async def process_audio_turn(
        self,
        *,
        session_id: str,
        user_id: str,
        audio_data: bytes,
    ) -> TeacherTurnOutcome:
        t0 = time.time()
        state = self.session_store.get(session_id, user_id)
        if not state:
            raise ValueError("Teacher mode is not active")

        lesson = self.lesson_store.get_lesson(state.lesson_id)
        fallback_reason = None
        error_tags: list[str] = []

        try:
            result = await self.adapter.evaluate_student_audio(
                audio_data=audio_data,
                lesson=lesson,
                session=state,
            )

            next_step_id = result.pedagogical_action.next_step_id
            allowed = lesson.allowed_transitions.get(state.current_step_id, [])
            if next_step_id != state.current_step_id and next_step_id not in allowed:
                fallback_reason = "invalid_transition"
                next_step_id = state.current_step_id
                teacher_action = TeacherAction.repeat_question
                reply_text = self._fallback_reply(state.current_step_id, lesson)
            else:
                teacher_action = result.pedagogical_action.teacher_action
                reply_text = self._limit_reply_text(result.tts_output.reply_text)

            state.current_step_id = next_step_id
            if teacher_action in {TeacherAction.correct_and_retry, TeacherAction.hint_and_retry, TeacherAction.repeat_question}:
                state.attempt_count += 1
            else:
                state.attempt_count = 0

            retry_limit = lesson.retry_limits.get(state.current_step_id, 2)
            if state.attempt_count >= retry_limit and teacher_action in {
                TeacherAction.correct_and_retry,
                TeacherAction.repeat_question,
            }:
                hint = lesson.hints.get(state.current_step_id) or self._step_hint(lesson, state.current_step_id)
                reply_text = self._limit_reply_text(f"Падказка: {hint}")
                teacher_action = TeacherAction.hint_and_retry
                fallback_reason = fallback_reason or "retry_limit_hint"

            if teacher_action == TeacherAction.finish_lesson:
                state.lesson_status = LessonStatus.completed

            state.recent_turn_summary = f"{result.evaluation.student_answer_status.value}:{result.input_understanding.normalized_transcript[:80]}"
            self.session_store.save(state)

            outcome = TeacherTurnOutcome(
                reply_text=reply_text,
                transcript=result.input_understanding.transcript,
                normalized_transcript=result.input_understanding.normalized_transcript,
                answer_status=result.evaluation.student_answer_status,
                teacher_action=teacher_action,
                step_id=state.current_step_id,
                fallback_reason=fallback_reason,
            )
            error_tags = list(result.evaluation.error_tags)

        except Exception:
            outcome = TeacherTurnOutcome(
                reply_text=self._fallback_reply(state.current_step_id, lesson),
                step_id=state.current_step_id,
                fallback_reason="model_or_parse_error",
            )

        latency_ms = int((time.time() - t0) * 1000)
        log_teacher_turn(
            user_id=user_id,
            session_id=session_id,
            lesson_id=state.lesson_id,
            outcome=outcome,
            error_tags=error_tags,
            latency_ms=latency_ms,
        )
        return outcome

    def _fallback_reply(self, step_id: str, lesson) -> str:
        hint = lesson.hints.get(step_id) or self._step_hint(lesson, step_id)
        return self._limit_reply_text(f"Не расслышала адказ. Паўтарым крок. {hint}")

    @staticmethod
    def _step_hint(lesson, step_id: str) -> str:
        for step in lesson.steps:
            if step.step_id == step_id:
                return step.hint or step.prompt
        return "Скажы кароткі адказ па-беларуску."

    @staticmethod
    def _limit_reply_text(text: str, max_chars: int = 220) -> str:
        cleaned = " ".join(text.split())
        return cleaned[:max_chars]
