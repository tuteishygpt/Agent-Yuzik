from __future__ import annotations

import json
import logging

from google.genai import types

import config
from api.teacher_mode.models import (
    EvaluationBlock,
    GeminiTeacherResult,
    InputUnderstanding,
    LessonDefinition,
    LessonSessionState,
    PedagogicalActionBlock,
    StudentAnswerStatus,
    TeacherAction,
    TTSBlock,
)

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
            "steps": [s.model_dump() for s in lesson.steps],
            "allowed_transitions": lesson.allowed_transitions,
            "retry_limits": lesson.retry_limits,
            "hints": lesson.hints,
            "finish_condition": lesson.finish_condition,
        }
        session_payload = session.model_dump()
        step_hint = self._step_hint(lesson=lesson, step_id=session.current_step_id)

        if not transcript_text:
            transcript_text = await self._transcribe_audio_with_model(
                audio_data=audio_data,
                lesson=lesson,
                session=session,
                step_hint=step_hint,
            )
            log.info(
                "teacher_adapter_remote_transcript lesson=%s step=%s transcript=%r",
                lesson.lesson_id,
                session.current_step_id,
                transcript_text,
            )

        if not transcript_text:
            return self._build_unclear_fallback(
                transcript="",
                lesson=lesson,
                session=session,
            )

        payload: dict | None = None
        try:
            payload = await self._evaluate_transcript(
                transcript=transcript_text,
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
            if not result.input_understanding.transcript.strip():
                result.input_understanding.transcript = transcript_text
            if not result.input_understanding.normalized_transcript.strip():
                result.input_understanding.normalized_transcript = transcript_text.lower()
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

    async def _transcribe_audio_with_model(
        self,
        *,
        audio_data: bytes,
        lesson: LessonDefinition,
        session: LessonSessionState,
        step_hint: str,
    ) -> str:
        from api.deps import get_genai_client

        client = get_genai_client()
        prompt = (
            "Transcribe this short student audio in Belarusian. "
            "Return only the recognized words, no explanations, no quotes, no markdown. "
            "If the child says only part of the answer, return exactly that partial answer. "
            "If speech is unclear, return an empty string.\n"
            f"Lesson: {lesson.title}\n"
            f"Current step: {session.current_step_id}\n"
            f"Expected hint: {step_hint}"
        )
        response = await client.aio.models.generate_content(
            model=config.SIMPLE_VOICE_MODEL,
            contents=[
                types.Content(
                    role="user",
                    parts=[
                        types.Part(text=prompt),
                        types.Part(inline_data=types.Blob(mime_type="audio/wav", data=audio_data)),
                    ],
                )
            ],
            config=types.GenerateContentConfig(
                temperature=0.0,
            ),
        )
        raw_text = (response.text or "").strip()
        cleaned = self._clean_transcript_text(raw_text)
        log.info(
            "teacher_adapter_remote_transcript_raw lesson=%s step=%s raw=%r cleaned=%r",
            lesson.lesson_id,
            session.current_step_id,
            raw_text[:300],
            cleaned,
        )
        return cleaned

    async def _evaluate_transcript(
        self,
        *,
        transcript: str,
        lesson_payload: dict,
        session_payload: dict,
    ) -> dict:
        from api.deps import get_genai_client

        client = get_genai_client()
        instruction = (
            "You are a Belarusian language teacher evaluator. Return ONLY strict JSON with fields: "
            "input_understanding, evaluation, pedagogical_action, tts_output. Keep reply_text short and voice-friendly. "
            "Give one main correction only. Use the transcript as the primary input. "
            "If the transcript is empty or unclear choose repeat_question or hint_and_retry. "
            "Do not output markdown."
        )
        response = await client.aio.models.generate_content(
            model=config.SIMPLE_VOICE_MODEL,
            contents=[
                types.Content(
                    role="user",
                    parts=[
                        types.Part(text=f"LESSON_CONTEXT={json.dumps(lesson_payload, ensure_ascii=False)}"),
                        types.Part(text=f"SESSION_STATE={json.dumps(session_payload, ensure_ascii=False)}"),
                        types.Part(text=f"ASR_TRANSCRIPT={transcript}"),
                        types.Part(text="Analyze the student's answer using the transcript."),
                    ],
                )
            ],
            config=types.GenerateContentConfig(
                system_instruction=instruction,
                temperature=0.2,
                response_mime_type="application/json",
            ),
        )
        raw_text = (response.text or "").strip()
        log.info("teacher_adapter_eval_raw raw=%r", raw_text[:500])
        return self._parse_json_payload(raw_text)

    @staticmethod
    def _parse_json_payload(text: str) -> dict:
        cleaned = text.strip()
        if cleaned.startswith("```"):
            lines = cleaned.splitlines()
            if lines and lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            cleaned = "\n".join(lines).strip()

        if cleaned.startswith("{") and cleaned.endswith("}"):
            return json.loads(cleaned)

        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(cleaned[start : end + 1])

        raise ValueError("Model did not return valid JSON object")

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
                or f"Добра. {GeminiTeacherAdapter._step_hint(lesson=lesson, step_id=session.current_step_id)}",
                "reply_style": "friendly",
                "max_tts_length_seconds": 12,
            }

        return normalized

    @staticmethod
    def _clean_transcript_text(text: str) -> str:
        cleaned = text.strip().strip('"').strip("'")
        cleaned = cleaned.removeprefix("ASR_TRANSCRIPT=").strip()
        lower = cleaned.lower()
        for prefix in ("transcript:", "recognized:", "response:"):
            if lower.startswith(prefix):
                cleaned = cleaned[len(prefix) :].strip()
                break
        if cleaned.startswith("```") and cleaned.endswith("```"):
            cleaned = "\n".join(cleaned.splitlines()[1:-1]).strip()
        return " ".join(cleaned.split())

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
                reply_text=f"Дрэнна пачуў адказ. Паўтарым крок. {hint}".strip(),
                reply_style="friendly",
                max_tts_length_seconds=12,
            ),
        )
