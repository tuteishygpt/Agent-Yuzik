from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from api.teacher_mode.controller import TeacherController
from api.teacher_mode.lesson_store import LessonStore
from api.teacher_mode.models import (
    EvaluationBlock,
    GeminiTeacherResult,
    InputUnderstanding,
    PedagogicalActionBlock,
    StudentAnswerStatus,
    TeacherAction,
    TTSBlock,
)
from api.teacher_mode.session_store import SessionStateStore


class FakeAdapter:
    def __init__(self, result: GeminiTeacherResult):
        self._result = result

    async def evaluate_student_audio(self, **kwargs):
        return self._result


def _result(next_step_id: str, action: TeacherAction, status: StudentAnswerStatus = StudentAnswerStatus.correct):
    return GeminiTeacherResult(
        input_understanding=InputUnderstanding(
            transcript="добры дзень",
            normalized_transcript="добры дзень",
            detected_language="be",
            audio_quality_status="ok",
        ),
        evaluation=EvaluationBlock(
            student_answer_status=status,
            confidence=0.9,
            matched_target="добры дзень",
            error_tags=[],
        ),
        pedagogical_action=PedagogicalActionBlock(
            teacher_action=action,
            next_step_id=next_step_id,
            state_patch={},
        ),
        tts_output=TTSBlock(reply_text="Выдатна, ідзем далей!", reply_style="friendly", max_tts_length_seconds=8),
    )


def test_teacher_controller_valid_transition_advances():
    lesson_store = LessonStore()
    session_store = SessionStateStore()
    adapter = FakeAdapter(_result("ask_name", TeacherAction.praise_and_advance))
    controller = TeacherController(lesson_store, session_store, adapter)

    controller.start_lesson(session_id="s1", user_id="u1", lesson_id="basics_greetings")
    out = asyncio.run(controller.process_audio_turn(session_id="s1", user_id="u1", audio_data=b"x"))

    state = controller.get_state(session_id="s1", user_id="u1")
    assert state is not None
    assert state.current_step_id == "ask_name"
    assert out.teacher_action == TeacherAction.praise_and_advance


def test_teacher_controller_invalid_transition_fallbacks():
    lesson_store = LessonStore()
    session_store = SessionStateStore()
    adapter = FakeAdapter(_result("summary", TeacherAction.praise_and_advance))
    controller = TeacherController(lesson_store, session_store, adapter)

    controller.start_lesson(session_id="s2", user_id="u2", lesson_id="basics_greetings")
    out = asyncio.run(controller.process_audio_turn(session_id="s2", user_id="u2", audio_data=b"x"))

    state = controller.get_state(session_id="s2", user_id="u2")
    assert state is not None
    assert state.current_step_id == "intro"
    assert out.teacher_action == TeacherAction.repeat_question
    assert out.fallback_reason == "invalid_transition"


def test_teacher_controller_retry_limit_turns_into_hint():
    lesson_store = LessonStore()
    session_store = SessionStateStore()
    adapter = FakeAdapter(_result("intro", TeacherAction.correct_and_retry, StudentAnswerStatus.incorrect))
    controller = TeacherController(lesson_store, session_store, adapter)

    controller.start_lesson(session_id="s3", user_id="u3", lesson_id="basics_greetings")
    out1 = asyncio.run(controller.process_audio_turn(session_id="s3", user_id="u3", audio_data=b"x"))
    out2 = asyncio.run(controller.process_audio_turn(session_id="s3", user_id="u3", audio_data=b"x"))

    assert out1.teacher_action in {TeacherAction.correct_and_retry, TeacherAction.hint_and_retry}
    assert out2.teacher_action == TeacherAction.hint_and_retry
    assert out2.fallback_reason == "retry_limit_hint"
