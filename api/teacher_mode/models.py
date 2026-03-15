from __future__ import annotations

from enum import Enum
from typing import Dict, List, Literal

from pydantic import BaseModel, Field


class StepType(str, Enum):
    intro = "intro"
    ask = "ask"
    sentence = "sentence"
    summary = "summary"


class LessonStep(BaseModel):
    step_id: str
    type: StepType
    prompt: str
    expected_answer: str | None = None
    hint: str | None = None


class LessonDefinition(BaseModel):
    lesson_id: str
    title: str
    level: str
    lesson_goal: str
    lesson_words: List[str] = Field(default_factory=list)
    steps: List[LessonStep]
    allowed_transitions: Dict[str, List[str]]
    retry_limits: Dict[str, int] = Field(default_factory=dict)
    hints: Dict[str, str] = Field(default_factory=dict)
    finish_condition: str


class LessonStatus(str, Enum):
    idle = "idle"
    active = "active"
    completed = "completed"
    stopped = "stopped"


class LessonSessionState(BaseModel):
    session_id: str
    user_id: str
    lesson_id: str
    current_step_id: str
    attempt_count: int = 0
    mistakes_to_review: List[str] = Field(default_factory=list)
    mode: Literal["assistant", "teacher"] = "teacher"
    lesson_status: LessonStatus = LessonStatus.active
    recent_turn_summary: str = ""


class StudentAnswerStatus(str, Enum):
    correct = "correct"
    partially_correct = "partially_correct"
    incorrect = "incorrect"
    off_topic = "off_topic"
    unclear = "unclear"


class TeacherAction(str, Enum):
    praise_and_advance = "praise_and_advance"
    correct_and_retry = "correct_and_retry"
    hint_and_retry = "hint_and_retry"
    simplify = "simplify"
    repeat_question = "repeat_question"
    move_to_review = "move_to_review"
    finish_lesson = "finish_lesson"


class InputUnderstanding(BaseModel):
    transcript: str = ""
    normalized_transcript: str = ""
    detected_language: str = "unknown"
    audio_quality_status: str = "ok"


class EvaluationBlock(BaseModel):
    student_answer_status: StudentAnswerStatus
    confidence: float = Field(ge=0.0, le=1.0)
    matched_target: str = ""
    error_tags: List[str] = Field(default_factory=list)


class PedagogicalActionBlock(BaseModel):
    teacher_action: TeacherAction
    next_step_id: str
    state_patch: Dict[str, str | int | List[str]] = Field(default_factory=dict)


class TTSBlock(BaseModel):
    reply_text: str
    reply_style: str = "friendly"
    max_tts_length_seconds: int = 12


class GeminiTeacherResult(BaseModel):
    input_understanding: InputUnderstanding
    evaluation: EvaluationBlock
    pedagogical_action: PedagogicalActionBlock
    tts_output: TTSBlock


class TeacherTurnOutcome(BaseModel):
    reply_text: str
    transcript: str = ""
    normalized_transcript: str = ""
    answer_status: StudentAnswerStatus = StudentAnswerStatus.unclear
    teacher_action: TeacherAction = TeacherAction.repeat_question
    step_id: str
    fallback_reason: str | None = None
