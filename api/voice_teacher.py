# api/voice_teacher.py
"""Teacher mode handler for the voice pipeline."""

from __future__ import annotations

import asyncio
import logging
import time

from fastapi import WebSocket

import config
from api.teacher_mode.service import controller as teacher_controller
from api.voice_perf import PerfLogger
from api.voice_simple import TTSWorker, _step
from services.dialogue_logging import append_dialogue_turn

log = logging.getLogger("app.voice")


async def _transcribe_audio_with_model(audio_data: bytes) -> str:
    """Remote ASR fallback for teacher mode (delegates to Gemini)."""
    from api.voice_simple import _transcribe_audio_with_model as _impl
    return await _impl(audio_data)


async def handle_teacher_voice(
    audio_data: bytes,
    websocket: WebSocket,
    audio_queue: asyncio.Queue,
    perf: PerfLogger,
    start_ts: float,
    session_id: str,
    user_id: str,
    teacher_state,
    user_label: str | None = None,
) -> None:
    """Process a voice turn in teacher mode."""
    log.info(_step("VOICE·TEACHER", f"📚 Teacher mode active | lesson={teacher_state.lesson_id}", start_ts))
    await perf(
        "teacher_mode",
        "📚 Рэжым настаўніка актыўны",
        detail=f"lesson_id={teacher_state.lesson_id} | step={teacher_state.current_step_id}",
        duration_ms=round((time.time() - start_ts) * 1000),
    )

    tts = TTSWorker(audio_queue, perf, start_ts)
    tts.start()
    try:
        transcript = await _transcribe_for_teacher(audio_data, start_ts)

        outcome = await teacher_controller.process_audio_turn(
            session_id=session_id,
            user_id=user_id,
            audio_data=audio_data,
            transcript=transcript,
        )

        log.info(
            _step(
                "VOICE·TEACHER",
                f"📝 Teacher transcript result: «{outcome.transcript[:120]}» | normalized=«{outcome.normalized_transcript[:120]}»",
                start_ts,
            )
        )

        if outcome.transcript:
            await websocket.send_json({"type": "transcription", "text": outcome.transcript})

        await websocket.send_json({
            "type": "response",
            "text": outcome.reply_text,
            "mode": "teacher",
            "teacher_action": outcome.teacher_action.value,
            "step_id": outcome.step_id,
            "fallback_reason": outcome.fallback_reason,
        })

        await asyncio.to_thread(
            append_dialogue_turn,
            config.TEACHER_DIALOGUE_LOG_PATH,
            user_id=user_id,
            user_label=user_label,
            user_text=outcome.transcript or transcript,
            assistant_text=outcome.reply_text,
            logger=log,
        )
        await tts.dispatch(outcome.reply_text)
        await tts.stop()
    finally:
        tts.cancel()


async def _transcribe_for_teacher(audio_data: bytes, start_ts: float) -> str:
    """Transcribe audio for teacher mode with remote ASR.

    Teacher mode expects Gemini to evaluate the learner's original audio turn.
    Keep this independent from LOCAL_ASR so local model availability cannot
    change lesson behavior.
    """
    log.info(_step("VOICE·TEACHER", "📝 Teacher mode uses remote transcription", start_ts))
    transcript = await _transcribe_audio_with_model(audio_data)
    log.info(_step("VOICE·TEACHER", f"📝 Remote transcript: «{transcript[:120]}»", start_ts))
    return transcript
