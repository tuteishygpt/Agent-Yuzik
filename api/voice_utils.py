# api/voice_utils.py
"""
Shared utilities for voice mode: constants, WAV header, binary audio sending.
"""

from __future__ import annotations

import struct
import logging

from fastapi import WebSocket

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
    """Wrap raw PCM in a WAV header if not already WAV."""
    if audio_bytes[:4] == b'RIFF':
        return audio_bytes
    return create_wav_header(len(audio_bytes)) + audio_bytes
