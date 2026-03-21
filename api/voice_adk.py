# api/voice_adk.py
"""
ADK Agent voice handler: processes audio through the router_agent pipeline.

Runs the ADK agent, collects text responses and audio artifacts,
then streams TTS for any text-only responses.
"""

from __future__ import annotations

import asyncio
import logging
import time

from fastapi import WebSocket

import config
from api.deps import adk_service, adk_session_store, artifact_store
from api.voice_perf import PerfLogger
from api.voice_utils import send_audio_chunk, compress_wav_to_mp3
from tools.text_to_speech_tool import stream_speech

log = logging.getLogger("app.voice")


async def handle_adk_voice(
    audio_data: bytes,
    websocket: WebSocket,
    session_id: str,
    user_id: str,
    perf: PerfLogger,
):
    """Process audio via ADK agent pipeline."""
    start_ts = perf.start_ts
    collected_text = []

    # ── Compress WAV → MP3 before sending to agent ──
    log.info(f"[VOICE·ADK·COMPRESS] Compressing WAV→MP3 | input={len(audio_data)}B")
    mp3_data = await asyncio.to_thread(compress_wav_to_mp3, audio_data)
    log.info(f"[VOICE·ADK·COMPRESS] Done: {len(audio_data)}B → {len(mp3_data)}B")

    async for ev in adk_service.run_agent_stream(
        session_id=session_id,
        user_id=user_id,
        text=None,
        file_data=mp3_data,
        mime_type="audio/mp3",
    ):
        if ev.is_final_response() and ev.content:
            text_parts = [p.text for p in ev.content.parts if p.text]
            if text_parts:
                full_text = "\n".join(text_parts)
                if "[Audio streamed directly]" not in full_text:
                    collected_text.append(full_text)
                    await websocket.send_json({
                        "type": "response",
                        "text": full_text,
                    })

        if ev.actions and ev.actions.artifact_delta:
            for filename, version in ev.actions.artifact_delta.items():
                try:
                    part = await adk_service.artifact_service.load_artifact(
                        app_name=adk_service.app_name,
                        user_id=user_id,
                        session_id=session_id,
                        filename=filename,
                        version=version,
                    )
                    if part and getattr(part, "inline_data", None):
                        mime_type = getattr(part.inline_data, "mime_type", "") or "application/octet-stream"
                        active_session = adk_session_store.get_active_session(
                            user_id,
                            adk_service.app_name,
                        )
                        artifact_store.store_assistant_artifact(
                            user_id=user_id,
                            conversation_id=active_session.get("conversation_id") if active_session else None,
                            filename=filename,
                            mime_type=mime_type,
                            data=part.inline_data.data,
                            adk_session_row_id=active_session["id"] if active_session else None,
                            metadata={"version": version, "session_id": session_id, "source": "voice_adk"},
                        )
                        if mime_type.startswith("audio"):
                            await websocket.send_bytes(part.inline_data.data)
                except Exception as exc:
                    log.error("Error loading audio artifact: %s", exc)

    # Stream TTS for collected text (ADK path)
    if collected_text:
        final_text = " ".join(collected_text)
        await perf(
            "tts_start",
            "🔊 Пачатак TTS генерацыі",
            detail=f"Даўжыня тэксту: {len(final_text)} сімвалаў",
            duration_ms=round((time.time() - start_ts) * 1000),
        )
        tts_start = time.time()
        first_chunk = True
        chunk_count = 0
        try:
            async for chunk in stream_speech(final_text):
                chunk_count += 1
                if first_chunk:
                    await perf(
                        "tts_first_chunk",
                        "🔊 Першы аўдыя чанк TTS",
                        detail=f"Затрымка TTS: {(time.time() - tts_start)*1000:.0f} мс",
                        duration_ms=round((time.time() - tts_start) * 1000),
                    )
                    first_chunk = False
                await send_audio_chunk(websocket, chunk, chunk_count)
        except Exception as tts_err:
            log.error(f"TTS streaming error: {tts_err}")

    return collected_text
