from __future__ import annotations

import logging
import re
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
from api.teacher_mode.phrases import TEACHER_PHRASES, prepend_praise, strip_leading_praise
from api.teacher_mode.session_store import SessionStateStore

log = logging.getLogger("app.voice.teacher")


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
        transcript: str = "",
    ) -> TeacherTurnOutcome:
        t0 = time.time()
        state = self.session_store.get(session_id, user_id)
        if not state:
            raise ValueError("Teacher mode is not active")

        lesson = self.lesson_store.get_lesson(state.lesson_id)
        fallback_reason = None
        error_tags: list[str] = []
        resolved_transcript = transcript.strip()
        resolved_normalized = resolved_transcript.lower()

        try:
            result = await self.adapter.evaluate_student_audio(
                audio_data=audio_data,
                transcript=transcript,
                lesson=lesson,
                session=state,
            )
            resolved_transcript = (result.input_understanding.transcript or resolved_transcript).strip()
            resolved_normalized = (
                result.input_understanding.normalized_transcript or resolved_transcript.lower()
            ).strip()

            next_step_id = result.pedagogical_action.next_step_id or state.current_step_id
            allowed = lesson.allowed_transitions.get(state.current_step_id, [])
            deterministic_step_id = self._matched_next_step_id(
                lesson=lesson,
                step_id=state.current_step_id,
                normalized_transcript=resolved_normalized,
            )
            if deterministic_step_id:
                next_step_id = deterministic_step_id
                teacher_action = TeacherAction.praise_and_advance
                reply_text = self._success_reply(lesson=lesson, step_id=next_step_id)
            elif next_step_id != state.current_step_id and next_step_id not in allowed:
                fallback_reason = "invalid_transition"
                next_step_id = state.current_step_id
                teacher_action = TeacherAction.repeat_question
                reply_text = self._fallback_reply(state.current_step_id, lesson)
            else:
                teacher_action = result.pedagogical_action.teacher_action
                reply_text = self._limit_reply_text(
                    self._normalize_reply_text(
                        result.tts_output.reply_text or self._fallback_reply(state.current_step_id, lesson),
                        step_id=state.current_step_id,
                    )
                )

            if teacher_action == TeacherAction.finish_lesson and state.current_step_id != "summary":
                fallback_reason = fallback_reason or "premature_finish_blocked"
                teacher_action = TeacherAction.praise_and_advance if next_step_id in allowed else TeacherAction.repeat_question
                if teacher_action == TeacherAction.praise_and_advance and next_step_id != state.current_step_id:
                    reply_text = self._success_reply(lesson=lesson, step_id=next_step_id)
                else:
                    next_step_id = state.current_step_id
                    reply_text = self._fallback_reply(state.current_step_id, lesson)

            state.current_step_id = next_step_id
            if teacher_action in {
                TeacherAction.correct_and_retry,
                TeacherAction.hint_and_retry,
                TeacherAction.repeat_question,
            }:
                state.attempt_count += 1
            else:
                state.attempt_count = 0

            retry_limit = lesson.retry_limits.get(state.current_step_id, 2)
            if state.attempt_count >= retry_limit and teacher_action in {
                TeacherAction.correct_and_retry,
                TeacherAction.repeat_question,
            }:
                hint = lesson.hints.get(state.current_step_id) or self._step_hint(lesson, state.current_step_id)
                reply_text = self._limit_reply_text(f"{TEACHER_PHRASES['retry_prefix']} {hint}")
                teacher_action = TeacherAction.hint_and_retry
                fallback_reason = fallback_reason or "retry_limit_hint"

            if teacher_action == TeacherAction.finish_lesson:
                state.lesson_status = LessonStatus.completed

            state.recent_turn_summary = f"{result.evaluation.student_answer_status.value}:{resolved_normalized[:80]}"
            self.session_store.save(state)

            outcome = TeacherTurnOutcome(
                reply_text=reply_text,
                transcript=resolved_transcript,
                normalized_transcript=resolved_normalized,
                answer_status=result.evaluation.student_answer_status,
                teacher_action=teacher_action,
                step_id=state.current_step_id,
                fallback_reason=fallback_reason,
            )
            error_tags = list(result.evaluation.error_tags)

        except Exception:
            log.exception(
                "teacher_controller_error lesson=%s step=%s transcript=%r normalized=%r",
                state.lesson_id,
                state.current_step_id,
                resolved_transcript,
                resolved_normalized,
            )
            outcome = TeacherTurnOutcome(
                reply_text=self._fallback_reply(state.current_step_id, lesson),
                transcript=resolved_transcript,
                normalized_transcript=resolved_normalized,
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
        return self._limit_reply_text(f"{TEACHER_PHRASES['fallback_reply_prefix']} {hint}")

    @staticmethod
    def _success_reply(*, lesson, step_id: str) -> str:
        for step in lesson.steps:
            if step.step_id == step_id:
                return TeacherController._limit_reply_text(prepend_praise(step.prompt, seed=step_id))
        return TeacherController._limit_reply_text(
            prepend_praise(TEACHER_PHRASES["fallback_success_reply"], seed=step_id)
        )

    @staticmethod
    def _normalize_reply_text(text: str, *, step_id: str) -> str:
        if not text:
            return ""
        if strip_leading_praise(text) != text.strip():
            return prepend_praise(text, seed=step_id)
        return text

    @staticmethod
    def _matched_next_step_id(*, lesson, step_id: str, normalized_transcript: str) -> str | None:
        normalized_transcript = TeacherController._normalize_text(normalized_transcript)
        if not normalized_transcript:
            return None

        current_step = None
        for step in lesson.steps:
            if step.step_id == step_id:
                current_step = step
                break
        if current_step is None:
            return None

        for candidate in TeacherController._step_expected_candidates(current_step):
            if candidate in normalized_transcript:
                next_steps = lesson.allowed_transitions.get(step_id, [])
                return next_steps[0] if next_steps else step_id
        return None

    @staticmethod
    def _step_expected_candidates(step) -> list[str]:
        candidates: list[str] = []
        for raw in (step.expected_answer, step.hint, step.prompt):
            if not raw:
                continue

            normalized = TeacherController._normalize_text(raw)
            if normalized:
                candidates.append(normalized)

            if ":" in raw:
                _, suffix = raw.split(":", 1)
                normalized_suffix = TeacherController._normalize_text(suffix)
                if normalized_suffix:
                    candidates.append(normalized_suffix)

        unique_candidates: list[str] = []
        for candidate in candidates:
            if candidate not in unique_candidates:
                unique_candidates.append(candidate)
        return unique_candidates

    @staticmethod
    def _normalize_text(text: str) -> str:
        lowered = text.lower().replace("\u0451", "\u0435")
        cleaned = re.sub(r"[^\w\s]", " ", lowered, flags=re.UNICODE)
        return " ".join(cleaned.split())

    @staticmethod
    def _step_hint(lesson, step_id: str) -> str:
        for step in lesson.steps:
            if step.step_id == step_id:
                return step.hint or step.prompt
        return TEACHER_PHRASES["generic_short_answer"]

    @staticmethod
    def _limit_reply_text(text: str, max_chars: int = 220) -> str:
        cleaned = " ".join(text.split())
        return cleaned[:max_chars]
