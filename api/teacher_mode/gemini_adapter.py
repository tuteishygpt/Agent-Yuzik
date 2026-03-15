from __future__ import annotations

import json

from google.genai import types

import config
from api.teacher_mode.models import GeminiTeacherResult, LessonDefinition, LessonSessionState
from api.voice_utils import compress_wav_to_mp3


class GeminiTeacherAdapter:
    async def evaluate_student_audio(
        self,
        *,
        audio_data: bytes,
        lesson: LessonDefinition,
        session: LessonSessionState,
    ) -> GeminiTeacherResult:
        from api.deps import get_genai_client
        client = get_genai_client()
        mp3_data = await __import__("asyncio").to_thread(compress_wav_to_mp3, audio_data)

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

        instruction = (
            "You are a Belarusian language teacher evaluator. Return ONLY strict JSON with fields: "
            "input_understanding, evaluation, pedagogical_action, tts_output. Keep reply_text short and voice-friendly. "
            "Give one main correction only. If audio is unclear choose repeat_question or hint_and_retry. "
            "Do not output markdown."
        )

        contents = [
            types.Content(
                role="user",
                parts=[
                    types.Part(text=f"LESSON_CONTEXT={json.dumps(lesson_payload, ensure_ascii=False)}"),
                    types.Part(text=f"SESSION_STATE={json.dumps(session_payload, ensure_ascii=False)}"),
                    types.Part(text="Analyze student answer from audio."),
                    types.Part(inline_data=types.Blob(mime_type="audio/mp3", data=mp3_data)),
                ],
            )
        ]

        response = await client.aio.models.generate_content(
            model=config.SIMPLE_VOICE_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=instruction,
                temperature=0.2,
                response_mime_type="application/json",
            ),
        )

        text = (response.text or "").strip()
        payload = json.loads(text)
        return GeminiTeacherResult.model_validate(payload)
