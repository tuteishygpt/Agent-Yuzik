from __future__ import annotations

import asyncio
import os
import sys
import wave
from io import BytesIO

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from api.teacher_mode.controller import TeacherController
from api.teacher_mode.gemini_adapter import GeminiTeacherAdapter
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


class BrokenAdapter:
    async def evaluate_student_audio(self, **kwargs):
        raise ValueError("bad model payload")


class StubTeacherAdapter(GeminiTeacherAdapter):
    def __init__(self, *, transcript_text: str = "", payload: dict | None = None):
        self.transcript_text = transcript_text
        self.payload = payload

    async def _transcribe_audio_with_model(self, **kwargs) -> str:
        return self.transcript_text

    async def _evaluate_transcript(self, **kwargs) -> dict:
        if self.payload is None:
            raise ValueError("missing payload")
        return self.payload


def _result(
    next_step_id: str,
    action: TeacherAction,
    status: StudentAnswerStatus = StudentAnswerStatus.correct,
):
    return GeminiTeacherResult(
        input_understanding=InputUnderstanding(
            transcript="dobry dzien",
            normalized_transcript="dobry dzien",
            detected_language="be",
            audio_quality_status="ok",
        ),
        evaluation=EvaluationBlock(
            student_answer_status=status,
            confidence=0.9,
            matched_target="dobry dzien",
            error_tags=[],
        ),
        pedagogical_action=PedagogicalActionBlock(
            teacher_action=action,
            next_step_id=next_step_id,
            state_patch={},
        ),
        tts_output=TTSBlock(
            reply_text="Vyadatna, idzem dalej!",
            reply_style="friendly",
            max_tts_length_seconds=8,
        ),
    )


def _wav_bytes() -> bytes:
    buf = BytesIO()
    with wave.open(buf, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(16000)
        wav_file.writeframes(b"\x00\x00" * 1600)
    return buf.getvalue()


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


def test_teacher_controller_preserves_transcript_on_fallback():
    lesson_store = LessonStore()
    session_store = SessionStateStore()
    controller = TeacherController(lesson_store, session_store, BrokenAdapter())

    controller.start_lesson(session_id="s4", user_id="u4", lesson_id="basics_family")
    out = asyncio.run(
        controller.process_audio_turn(
            session_id="s4",
            user_id="u4",
            audio_data=b"x",
            transcript="mama i tata",
        )
    )

    assert out.fallback_reason == "model_or_parse_error"
    assert out.transcript == "mama i tata"
    assert out.normalized_transcript == "mama i tata"


def test_teacher_adapter_uses_remote_transcript_when_input_transcript_missing():
    lesson = LessonStore().get_lesson("basics_family")
    session = TeacherController(
        LessonStore(),
        SessionStateStore(),
        FakeAdapter(_result("intro", TeacherAction.repeat_question)),
    ).start_lesson(session_id="s6", user_id="u6", lesson_id="basics_family")
    adapter = StubTeacherAdapter(
        transcript_text="mama i tata",
        payload={
            "input_understanding": {
                "transcript": "",
                "normalized_transcript": "",
                "detected_language": "be",
                "audio_quality_status": "ok",
            },
            "evaluation": {
                "student_answer_status": "correct",
                "confidence": 0.9,
                "matched_target": "mama i tata",
                "error_tags": [],
            },
            "pedagogical_action": {
                "teacher_action": "praise_and_advance",
                "next_step_id": "ask_sister",
                "state_patch": {},
            },
            "tts_output": {
                "reply_text": "Vyadatna, idzem dalej!",
                "reply_style": "friendly",
                "max_tts_length_seconds": 8,
            },
        },
    )

    result = asyncio.run(
        adapter.evaluate_student_audio(
            audio_data=_wav_bytes(),
            transcript="",
            lesson=lesson,
            session=session,
        )
    )

    assert result.input_understanding.transcript == "mama i tata"
    assert result.input_understanding.normalized_transcript == "mama i tata"
    assert result.evaluation.student_answer_status == StudentAnswerStatus.correct
    assert result.pedagogical_action.next_step_id == "ask_sister"


def test_teacher_adapter_returns_unclear_fallback_for_invalid_json():
    adapter = GeminiTeacherAdapter()
    lesson = LessonStore().get_lesson("basics_family")
    session = TeacherController(
        LessonStore(),
        SessionStateStore(),
        FakeAdapter(_result("intro", TeacherAction.repeat_question)),
    ).start_lesson(session_id="s5", user_id="u5", lesson_id="basics_family")

    result = adapter._build_unclear_fallback(
        transcript="",
        lesson=lesson,
        session=session,
    )
    assert result.evaluation.student_answer_status == StudentAnswerStatus.unclear
    assert result.pedagogical_action.teacher_action == TeacherAction.repeat_question
    assert "мама" in result.tts_output.reply_text.lower()


def test_teacher_adapter_normalizes_simplified_model_payload():
    lesson = LessonStore().get_lesson("basics_greetings")
    session = TeacherController(
        LessonStore(),
        SessionStateStore(),
        FakeAdapter(_result("intro", TeacherAction.repeat_question)),
    ).start_lesson(session_id="s7", user_id="u7", lesson_id="basics_greetings")

    payload = GeminiTeacherAdapter._normalize_payload(
        payload={
            "input_understanding": "The student correctly said 'Добры дзень'.",
            "evaluation": "correct",
            "pedagogical_action": "proceed_to_next_step",
            "tts_output": "Выдатна! Цяпер давай пазнаёмімся. Як сказаць: Мяне завуць...?",
        },
        transcript="Добры дзень",
        lesson=lesson,
        session=session,
    )

    result = GeminiTeacherResult.model_validate(payload)
    assert result.input_understanding.transcript == "Добры дзень"
    assert result.evaluation.student_answer_status == StudentAnswerStatus.correct
    assert result.pedagogical_action.teacher_action == TeacherAction.praise_and_advance
    assert result.pedagogical_action.next_step_id == "ask_name"
