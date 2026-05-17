# api/voice_utils.py
"""
Shared utilities for voice mode: constants, WAV header, binary audio sending,
and audio compression (WAV → MP3).
"""

from __future__ import annotations

import io
import struct
import logging
import time

from fastapi import WebSocket
from pydub import AudioSegment

import config

log = logging.getLogger("app.voice")

# Sample rate for local XTTS
LOCAL_SAMPLE_RATE = 24000

# End-of-audio marker (binary protocol)
END_MARKER = b'END\x00'
END_MARKER_SIZE = 8  # 4-byte marker + 4-byte uint32 timestamp


def create_wav_header(data_len: int) -> bytes:
    """Create WAV header for PCM 16kHz 16-bit Mono."""
    return struct.pack(
        '<4sI4s4sIHHIIHH4sI',
        b'RIFF', data_len + 36, b'WAVE',
        b'fmt ', 16, 1, 1, 16000, 32000, 2, 16,
        b'data', data_len,
    )


async def send_audio_chunk(websocket: WebSocket, chunk: bytes, chunk_idx: int):
    """Send audio chunk via WebSocket. Local mode = binary PCM, API mode = binary WAV."""
    if config.TTS_MODE == "local":
        # Binary protocol: 4-byte magic "PCM\0" + 4-byte uint32 LE sample count + raw Float32 PCM
        samples = len(chunk) // 4  # Float32 = 4 bytes/sample
        header = struct.pack('<4sI', b'PCM\x00', samples)
        await websocket.send_bytes(header + chunk)
    else:
        await websocket.send_bytes(chunk)


def extract_end_marker(raw: bytes):
    """Check if binary data ends with 8-byte END\\0 trailer.
    Returns (audio_bytes, client_ts_low32) or (None, None) if no marker.
    """
    # 44 WAV header + at least some data + 8 trailer
    if len(raw) >= 52 and raw[-8:-4] == END_MARKER:
        client_ts = struct.unpack_from('<I', raw, len(raw) - 4)[0]
        return bytes(raw[:-8]), client_ts
    return None, None


def ensure_wav(audio_bytes: bytes) -> bytes:
    """Convert audio to WAV. Supports WAV passthrough, container formats
    (m4a/mp3/ogg via pydub/ffmpeg), and raw PCM fallback."""
    if audio_bytes[:4] == b'RIFF':
        return audio_bytes
    try:
        audio = AudioSegment.from_file(io.BytesIO(audio_bytes))
        audio = audio.set_frame_rate(16000).set_channels(1).set_sample_width(2)
        buf = io.BytesIO()
        audio.export(buf, format="wav")
        return buf.getvalue()
    except Exception:
        return create_wav_header(len(audio_bytes)) + audio_bytes


def compress_wav_to_mp3(wav_data: bytes, sample_rate: int = 16000, bitrate: str = "64k") -> bytes:
    """Compress WAV audio to MP3 at the given sample rate.

    Uses pydub (backed by ffmpeg) to re-encode WAV → MP3 mono.
    Returns the MP3 bytes. This is a synchronous/blocking call;
    use ``asyncio.to_thread`` or ``loop.run_in_executor`` when calling
    from async code.

    Args:
        wav_data: Raw WAV file bytes (RIFF header + PCM data).
        sample_rate: Target sample rate in Hz (default 16000).
        bitrate: MP3 bitrate string, e.g. "64k" or "32k".

    Returns:
        MP3 file bytes.
    """
    t0 = time.time()
    audio = AudioSegment.from_file(io.BytesIO(wav_data), format="wav")
    audio = audio.set_frame_rate(sample_rate).set_channels(1)

    mp3_buf = io.BytesIO()
    audio.export(mp3_buf, format="mp3", bitrate=bitrate)
    mp3_bytes = mp3_buf.getvalue()

    elapsed_ms = (time.time() - t0) * 1000
    ratio = len(wav_data) / len(mp3_bytes) if mp3_bytes else 0
    log.info(
        f"[VOICE·COMPRESS] WAV→MP3: {len(wav_data)}B → {len(mp3_bytes)}B "
        f"(×{ratio:.1f} сцісканне) | {elapsed_ms:.0f} мс | "
        f"sr={sample_rate} bitrate={bitrate}"
    )
    return mp3_bytes

