from __future__ import annotations

import asyncio
import json
import logging

from google.genai import types

import config
from api.voice_utils import compress_wav_to_mp3
from api.teacher_mode.models import (
    EvaluationBlock,
    GeminiTeacherResult,
    GeminiTeacherStructuredResult,
    InputUnderstanding,
    LessonDefinition,
    LessonSessionState,
    PedagogicalActionBlock,
    StepType,
    StudentAnswerStatus,
    TeacherAction,
    TTSBlock,
)
from api.teacher_mode.phrases import TEACHER_PHRASES

log = logging.getLogger("app.voice.teacher")


class GeminiTeacherAdapter:
    async def evaluate_student_audio(
        self,
        *,
        audio_data: bytes,
        transcript: str,
        lesson: LessonDefinition,
        session: LessonSessionState,
    ) -> GeminiTeacherResult:
        transcript_text = transcript.strip()

        lesson_payload = {
            "lesson_id": lesson.lesson_id,
            "title": lesson.title,
            "level": lesson.level,
            "lesson_goal": lesson.lesson_goal,
            "lesson_words": lesson.lesson_words,
            "steps": [s.model_dump() for s in lesson.steps],
            "allowed_transitions": lesson.allowed_transitions,
            "retry_limits": lesson.retry_limits,
            "hints": lesson.hints,
            "finish_condition": lesson.finish_condition,
        }
        session_payload = session.model_dump()

        payload: dict | None = None

        try:
            if payload is None:
                if transcript_text:
                    payload = await self._evaluate_transcript(
                        transcript=transcript_text,
                        lesson_payload=lesson_payload,
                        session_payload=session_payload,
                    )
                else:
                    payload = await self._evaluate_audio_with_model(
                        audio_data=audio_data,
                        lesson=lesson,
                        session=session,
                        lesson_payload=lesson_payload,
                        session_payload=session_payload,
                    )

            payload = self._normalize_payload(
                payload=payload,
                transcript=transcript_text,
                lesson=lesson,
                session=session,
            )
            result = GeminiTeacherResult.model_validate(payload)
            if not transcript_text:
                transcript_text = result.input_understanding.transcript.strip()
            if not result.input_understanding.transcript.strip():
                result.input_understanding.transcript = transcript_text
            if not result.input_understanding.normalized_transcript.strip():
                result.input_understanding.normalized_transcript = transcript_text.lower()
            if not transcript_text:
                return self._build_unclear_fallback(
                    transcript="",
                    lesson=lesson,
                    session=session,
                )
            log.info(
                "teacher_adapter_eval_result lesson=%s step=%s status=%s action=%s next_step=%s transcript=%r",
                lesson.lesson_id,
                session.current_step_id,
                result.evaluation.student_answer_status.value,
                result.pedagogical_action.teacher_action.value,
                result.pedagogical_action.next_step_id,
                result.input_understanding.transcript,
            )
            return result
        except Exception as exc:
            log.warning(
                "teacher_adapter_parse_fallback lesson=%s step=%s transcript=%r error=%s raw=%r",
                lesson.lesson_id,
                session.current_step_id,
                transcript_text,
                str(exc),
                payload if payload is not None else "",
            )
            return self._build_unclear_fallback(
                transcript=transcript_text,
                lesson=lesson,
                session=session,
            )

    async def _evaluate_audio_with_model(
        self,
        *,
        audio_data: bytes,
        lesson: LessonDefinition,
        session: LessonSessionState,
        lesson_payload: dict,
        session_payload: dict,
    ) -> dict:
        from api.deps import get_voice_genai_client

        client = get_voice_genai_client()
        mp3_data = await self._compress_audio_for_gemini(audio_data)
        response = await client.aio.models.generate_content(
            model=config.SIMPLE_VOICE_MODEL,
            contents=[
                types.Content(
                    role="user",
                    parts=[
                        types.Part(
                            text=f"{TEACHER_PHRASES['lesson_context_prefix']}{json.dumps(lesson_payload, ensure_ascii=False)}"
                        ),
                        types.Part(
                            text=f"{TEACHER_PHRASES['session_state_prefix']}{json.dumps(session_payload, ensure_ascii=False)}"
                        ),
                        types.Part(text=TEACHER_PHRASES["evaluate_audio_instruction"]),
                    ]
                    + self._build_step_type_parts(lesson, session)
                    + [
                        types.Part(inline_data=types.Blob(mime_type="audio/mp3", data=mp3_data)),
                    ],
                )
            ],
            config=types.GenerateContentConfig(
                system_instruction=TEACHER_PHRASES["evaluate_instruction"],
                temperature=0.2,
                response_mime_type="application/json",
                response_schema=GeminiTeacherStructuredResult,
            ),
        )
        raw_text = (response.text or "").strip()
        log.info(
            "teacher_adapter_eval_audio_raw lesson=%s step=%s raw=%r",
            lesson.lesson_id,
            session.current_step_id,
            raw_text[:300],
        )
        return self._extract_structured_payload(response)

    async def _evaluate_transcript(
        self,
        *,
        transcript: str,
        lesson_payload: dict,
        session_payload: dict,
    ) -> dict:
        from api.deps import get_voice_genai_client

        client = get_voice_genai_client()
        instruction = TEACHER_PHRASES["evaluate_instruction"]
        response = await client.aio.models.generate_content(
            model=config.SIMPLE_VOICE_MODEL,
            contents=[
                types.Content(
                    role="user",
                    parts=[
                        types.Part(
                            text=f"{TEACHER_PHRASES['lesson_context_prefix']}{json.dumps(lesson_payload, ensure_ascii=False)}"
                        ),
                        types.Part(
                            text=f"{TEACHER_PHRASES['session_state_prefix']}{json.dumps(session_payload, ensure_ascii=False)}"
                        ),
                        types.Part(text=f"{TEACHER_PHRASES['asr_transcript_prefix']}{transcript}"),
                        types.Part(text=TEACHER_PHRASES["evaluate_transcript_instruction"]),
                    ]
                    + self._build_step_type_parts_from_payload(lesson_payload, session_payload),
                )
            ],
            config=types.GenerateContentConfig(
                system_instruction=instruction,
                temperature=0.2,
                response_mime_type="application/json",
                response_schema=GeminiTeacherStructuredResult,
            ),
        )
        raw_text = (response.text or "").strip()
        log.info("teacher_adapter_eval_raw raw=%r", raw_text[:500])
        return self._extract_structured_payload(response)

    async def _compress_audio_for_gemini(self, audio_data: bytes) -> bytes:
        return await asyncio.to_thread(compress_wav_to_mp3, audio_data)

    @staticmethod
    def _extract_structured_payload(response: types.GenerateContentResponse) -> dict:
        parsed = getattr(response, "parsed", None)
        if isinstance(parsed, dict):
            return dict(parsed)
        if hasattr(parsed, "model_dump"):
            return parsed.model_dump(mode="json")
        raise ValueError("Model did not return structured payload")

    def _build_step_type_parts(
        self,
        lesson: LessonDefinition,
        session: LessonSessionState,
    ) -> list[types.Part]:
        """Build extra instruction parts based on the current step type."""
        current_step = None
        for step in lesson.steps:
            if step.step_id == session.current_step_id:
                current_step = step
                break
        if current_step is None:
            return []
        return self._parts_for_step(current_step)

    def _build_step_type_parts_from_payload(
        self,
        lesson_payload: dict,
        session_payload: dict,
    ) -> list[types.Part]:
        """Build extra instruction parts from raw payloads (used for transcript eval)."""
        current_step_id = session_payload.get("current_step_id", "")
        for step_data in lesson_payload.get("steps", []):
            if step_data.get("step_id") == current_step_id:
                step_type = step_data.get("type", "")
                return self._parts_for_step_type(
                    step_type=step_type,
                    goal_description=step_data.get("goal_description"),
                    source_phrase=step_data.get("source_phrase"),
                    source_language=step_data.get("source_language"),
                    sentence_template=step_data.get("sentence_template"),
                    choices=step_data.get("choices"),
                )
        return []

    @staticmethod
    def _parts_for_step(step) -> list[types.Part]:
        return GeminiTeacherAdapter._parts_for_step_type(
            step_type=step.type.value if hasattr(step.type, "value") else str(step.type),
            goal_description=getattr(step, "goal_description", None),
            source_phrase=getattr(step, "source_phrase", None),
            source_language=getattr(step, "source_language", None),
            sentence_template=getattr(step, "sentence_template", None),
            choices=getattr(step, "choices", None),
        )

    @staticmethod
    def _parts_for_step_type(
        *,
        step_type: str,
        goal_description: str | None = None,
        source_phrase: str | None = None,
        source_language: str | None = None,
        sentence_template: str | None = None,
        choices: list[str] | None = None,
    ) -> list[types.Part]:
        parts: list[types.Part] = []
        if step_type == "roleplay":
            instruction = TEACHER_PHRASES["roleplay_evaluate_instruction"]
            if goal_description:
                instruction += f" Goal: {goal_description}"
            parts.append(types.Part(text=instruction))
        elif step_type == "translate":
            extra = f"This is a TRANSLATION step. The student must translate the phrase from {source_language or 'another language'} to Belarusian."
            if source_phrase:
                extra += f" Source phrase: \"{source_phrase}\""
            parts.append(types.Part(text=extra))
        elif step_type == "fill_blank":
            extra = "This is a FILL THE BLANK step. The student must complete the sentence."
            if sentence_template:
                extra += f" Template: \"{sentence_template}\""
            parts.append(types.Part(text=extra))
        elif step_type == "choice":
            extra = "This is a MULTIPLE CHOICE step. The student must choose the correct option."
            if choices:
                extra += f" Choices: {', '.join(choices)}"
            parts.append(types.Part(text=extra))
        return parts

    @staticmethod
    def _normalize_payload(
        *,
        payload: dict,
        transcript: str,
        lesson: LessonDefinition,
        session: LessonSessionState,
    ) -> dict:
        normalized = dict(payload)

        input_understanding = normalized.get("input_understanding")
        if not isinstance(input_understanding, dict):
            normalized["input_understanding"] = {
                "transcript": transcript,
                "normalized_transcript": transcript.lower(),
                "detected_language": "be" if transcript else "unknown",
                "audio_quality_status": "ok" if transcript else "unclear",
            }

        evaluation = normalized.get("evaluation")
        if not isinstance(evaluation, dict):
            status = str(evaluation or "unclear").strip().lower()
            allowed = {s.value for s in StudentAnswerStatus}
            if status not in allowed:
                status = StudentAnswerStatus.correct.value if "correct" in status else StudentAnswerStatus.unclear.value
            normalized["evaluation"] = {
                "student_answer_status": status,
                "confidence": 0.9 if status == StudentAnswerStatus.correct.value else 0.3,
                "matched_target": transcript if status == StudentAnswerStatus.correct.value else "",
                "error_tags": [],
            }

        pedagogical_action = normalized.get("pedagogical_action")
        if not isinstance(pedagogical_action, dict):
            raw_action = str(pedagogical_action or "").strip().lower()
            next_steps = lesson.allowed_transitions.get(session.current_step_id, [])
            next_step = next_steps[0] if next_steps else session.current_step_id
            teacher_action = TeacherAction.repeat_question.value
            if raw_action in {"proceed_to_next_step", "advance", "praise_and_advance"}:
                teacher_action = TeacherAction.praise_and_advance.value
            elif raw_action in {"hint_and_retry", "correct_and_retry", "repeat_question"}:
                teacher_action = raw_action
                next_step = session.current_step_id
            normalized["pedagogical_action"] = {
                "teacher_action": teacher_action,
                "next_step_id": next_step if teacher_action == TeacherAction.praise_and_advance.value else session.current_step_id,
                "state_patch": {},
            }

        tts_output = normalized.get("tts_output")
        if not isinstance(tts_output, dict):
            normalized["tts_output"] = {
                "reply_text": str(tts_output or "").strip()
                or f"{TEACHER_PHRASES['generic_acknowledgement']} {GeminiTeacherAdapter._step_hint(lesson=lesson, step_id=session.current_step_id)}",
                "reply_style": "friendly",
                "max_tts_length_seconds": 12,
            }

        return normalized

    @staticmethod
    def _step_hint(*, lesson: LessonDefinition, step_id: str) -> str:
        for step in lesson.steps:
            if step.step_id == step_id:
                return step.hint or step.prompt
        return ""

    @staticmethod
    def _build_unclear_fallback(
        *,
        transcript: str,
        lesson: LessonDefinition,
        session: LessonSessionState,
    ) -> GeminiTeacherResult:
        hint = ""
        for step in lesson.steps:
            if step.step_id == session.current_step_id:
                hint = step.hint or step.prompt
                break

        transcript_text = transcript.strip()
        error_tags = ["empty_transcript"] if not transcript_text else ["model_parse_error"]

        return GeminiTeacherResult(
            input_understanding=InputUnderstanding(
                transcript=transcript_text,
                normalized_transcript=transcript_text.lower(),
                detected_language="unknown",
                audio_quality_status="unclear" if not transcript_text else "ok",
            ),
            evaluation=EvaluationBlock(
                student_answer_status=StudentAnswerStatus.unclear,
                confidence=0.0,
                matched_target="",
                error_tags=error_tags,
            ),
            pedagogical_action=PedagogicalActionBlock(
                teacher_action=TeacherAction.repeat_question,
                next_step_id=session.current_step_id,
                state_patch={},
            ),
            tts_output=TTSBlock(
                reply_text=f"{TEACHER_PHRASES['fallback_reply_prefix']} {hint}".strip(),
                reply_style="friendly",
                max_tts_length_seconds=12,
            ),
        )
