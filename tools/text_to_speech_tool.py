# tools/text_to_speech_tool.py
"""
Інструмент для сінтэзу маўлення (Belarusian TTS).

Падтрымлівае два рэжымы (задаецца праз TTS_MODE у .env):
  • "local" — лакальны XTTS (патрэбны GPU + coqui-ai-TTS)
  • "api"   — Gradio API (HuggingFace Spaces, без цяжкіх залежнасцей)

Калі TTS_MODE=api, праект запускаецца без torch / coqui-ai-TTS.
"""


import os
import inspect
import traceback
from typing import Optional, AsyncGenerator, Dict, Any, Tuple
import asyncio
import logging

from google.genai import types
from google.adk.tools import FunctionTool, ToolContext

import config  # TTS_MODE, HF_TOKEN

log = logging.getLogger(__name__)

TTS_MODE = config.TTS_MODE  # "local" | "api"
log.info(f"TTS mode: {TTS_MODE}")

# ═══════════════════════════════════════════════════════════════════════
# Ініцыялізацыя бэкенда ў залежнасці ад рэжыму
# ═══════════════════════════════════════════════════════════════════════

if TTS_MODE == "api":
    # ── API mode: выкарыстоўваем gradio_client ──────────────────────
    import base64
    import re
    import struct
    from urllib.parse import urljoin

    import httpx
    from gradio_client import Client, handle_file

    HUGGINGFACE_API_TOKEN = config.HF_TOKEN or os.getenv("HF_TOKEN")
    voice_client = None

    def _make_gradio_client(src: str, token: Optional[str] = None) -> Client:
        """Create gradio_client.Client across versions with token/hf_token drift."""
        if not token:
            return Client(src)

        try:
            params = inspect.signature(Client.__init__).parameters
        except (TypeError, ValueError):
            params = {}

        if "hf_token" in params:
            return Client(src, hf_token=token)
        return Client(src, token=token)

    if HUGGINGFACE_API_TOKEN:
        gradio_client = _make_gradio_client(
            "archivartaunik/Bextts", HUGGINGFACE_API_TOKEN
        )
        try:
            voice_client = _make_gradio_client(
                "archivartaunik/BexttsAssist", HUGGINGFACE_API_TOKEN
            )
            log.info("BexttsAssist client initialized successfully.")
        except Exception as e:
            log.warning(f"Failed to initialize BexttsAssist: {e}")
    else:
        log.warning(
            "HF_TOKEN не зададзены — выкарыстоўваю ананімны доступ."
        )
        gradio_client = _make_gradio_client("archivartaunik/BeTTSNaciski")
        try:
            voice_client = _make_gradio_client("archivartaunik/BexttsAssist")
            log.info("BexttsAssist client initialized (anon).")
        except Exception as e:
            log.warning(f"Failed to initialize BexttsAssist (anon): {e}")

else:
    # ── Local mode: выкарыстоўваем local_xtts_service ───────────────
    from services.local_xtts_service import stream_audio, synthesize_to_file


# ═══════════════════════════════════════════════════════════════════════
# Global queues for voice streaming (абодва рэжымы)
# ═══════════════════════════════════════════════════════════════════════

voice_queues: Dict[str, Tuple[asyncio.Queue, asyncio.AbstractEventLoop]] = {}


def register_voice_user(
    user_id: str, queue: asyncio.Queue, loop: asyncio.AbstractEventLoop
):
    voice_queues[user_id] = (queue, loop)
    log.info(f"Registered voice queue for user {user_id}")


def unregister_voice_user(user_id: str):
    if user_id in voice_queues:
        del voice_queues[user_id]
        log.info(f"Unregistered voice queue for user {user_id}")


# ═══════════════════════════════════════════════════════════════════════
# Утыліты для API-рэжыму
# ═══════════════════════════════════════════════════════════════════════

def _looks_like_base64(s: str) -> bool:
    """Эўрыстыка: ці падобны радок на base64."""
    if not isinstance(s, str):
        return False
    if s.startswith(("http://", "https://")):
        return False
    if s.startswith("data:"):
        return True
    if len(s) > 100 and not any(c.isspace() for c in s):
        return True
    return False


def _add_wav_header_api(
    pcm_data: bytes, sample_rate: int = 24000, channels: int = 1
) -> bytes:
    """Дадае WAV-загаловак да сырых Float32 PCM-даных."""
    import struct

    byte_count = len(pcm_data)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        byte_count + 36,
        b"WAVE",
        b"fmt ",
        16,  # Subchunk1Size
        3,  # AudioFormat: IEEE Float
        channels,
        sample_rate,
        sample_rate * channels * 4,  # ByteRate
        channels * 4,  # BlockAlign
        32,  # BitsPerSample
        b"data",
        byte_count,
    )
    return header + pcm_data


def _read_audio_file_bytes(file_path: str) -> Optional[bytes]:
    """Read a local audio file and delete the temp copy when possible."""
    if not isinstance(file_path, str) or not os.path.exists(file_path):
        return None

    with open(file_path, "rb") as f:
        content = f.read()

    try:
        os.remove(file_path)
    except OSError:
        pass

    return content


def _decode_audio_base64(data: str) -> Optional[bytes]:
    """Decode a Gradio base64 payload into WAV bytes."""
    if not isinstance(data, str) or not _looks_like_base64(data):
        return None

    payload = data.split(",", 1)[1] if data.startswith("data:") else data
    try:
        raw = base64.b64decode(payload)
    except Exception:
        return None

    if not raw.startswith(b"RIFF"):
        raw = _add_wav_header_api(raw)
    return raw


def _download_audio_bytes(url: str) -> Optional[bytes]:
    """Download audio when Gradio returns FileData with a remote URL."""
    if not isinstance(url, str) or not url:
        return None

    if not (
        url.startswith(("http://", "https://"))
        or url.startswith("/gradio_api/")
        or url.startswith("/file=")
    ):
        return None

    resolved_url = url
    if "://" not in url and voice_client and getattr(voice_client, "src", None):
        resolved_url = urljoin(voice_client.src, url)

    try:
        response = httpx.get(
            resolved_url,
            headers=getattr(voice_client, "headers", None),
            cookies=getattr(voice_client, "cookies", None),
            verify=getattr(voice_client, "ssl_verify", True),
            follow_redirects=True,
            **getattr(voice_client, "httpx_kwargs", {}),
        )
        response.raise_for_status()
        return response.content
    except Exception as exc:
        log.warning(f"Failed to download TTS audio from {resolved_url}: {exc}")
        return None


def _summarize_tts_item(item: Any) -> str:
    """Compact log-friendly summary of a raw Gradio item."""
    if isinstance(item, str):
        preview = item[:80].replace("\n", "\\n")
        return f"str(len={len(item)}, preview={preview!r})"
    if isinstance(item, dict):
        return f"dict(keys={sorted(item.keys())})"
    if isinstance(item, tuple):
        return (
            f"tuple(len={len(item)}, "
            f"item_types={[type(part).__name__ for part in item]})"
        )
    if isinstance(item, list):
        return (
            f"list(len={len(item)}, "
            f"item_types={[type(part).__name__ for part in item]})"
        )
    return type(item).__name__


def _get_named_tts_endpoint(client) -> Any:
    """Resolve the best available named Gradio endpoint for TTS."""
    endpoints = getattr(client, "endpoints", {}) or {}
    valid_endpoints = []

    for endpoint in endpoints.values():
        api_name = getattr(endpoint, "api_name", None)
        if not api_name or api_name is False:
            continue
        if not getattr(endpoint, "is_valid", True):
            continue
        if getattr(endpoint, "backend_fn", None) is None:
            continue
        if getattr(endpoint, "show_api", True) is False:
            continue
        valid_endpoints.append(endpoint)

    for preferred_name in ("/predict", "/text_to_speech"):
        for endpoint in valid_endpoints:
            if getattr(endpoint, "api_name", None) == preferred_name:
                return endpoint

    if len(valid_endpoints) == 1:
        return valid_endpoints[0]

    available = sorted(
        endpoint.api_name
        for endpoint in valid_endpoints
        if isinstance(getattr(endpoint, "api_name", None), str)
    )
    raise ValueError(
        "Could not resolve a Gradio TTS endpoint. "
        f"Available named endpoints: {available or ['<none>']}"
    )


def _select_param_name(
    parameters_info: list[Dict[str, Any]],
    aliases: Tuple[str, ...],
    components: Tuple[str, ...],
    used_names: set[str],
) -> Optional[str]:
    for alias in aliases:
        if alias in used_names:
            continue
        for param in parameters_info:
            if param.get("parameter_name") == alias:
                return alias

    for param in parameters_info:
        name = param.get("parameter_name")
        if not isinstance(name, str) or name in used_names:
            continue
        if param.get("component") in components:
            return name

    for param in parameters_info:
        name = param.get("parameter_name")
        if isinstance(name, str) and name not in used_names:
            return name

    return None


def _build_tts_predict_kwargs(
    endpoint: Any, text: str, speaker_audio_path: Optional[str]
) -> Dict[str, Any]:
    parameters_info = getattr(endpoint, "parameters_info", None) or []
    audio_input = handle_file(speaker_audio_path) if speaker_audio_path else None

    if not parameters_info:
        return {
            "belarusian_story": text,
            "speaker_audio_file": audio_input,
        }

    used_names: set[str] = set()
    kwargs: Dict[str, Any] = {}

    text_param = _select_param_name(
        parameters_info,
        aliases=("belarusian_story", "text_input", "text"),
        components=("textbox", "textarea", "text"),
        used_names=used_names,
    )
    if not text_param:
        raise ValueError(
            f"Could not resolve text input parameter for endpoint {endpoint.api_name!r}."
        )
    used_names.add(text_param)
    kwargs[text_param] = text

    audio_param = _select_param_name(
        parameters_info,
        aliases=("speaker_audio_file", "speaker_audio", "audio"),
        components=("audio", "file"),
        used_names=used_names,
    )
    if audio_param:
        kwargs[audio_param] = audio_input
    elif speaker_audio_path:
        log.warning(
            "Speaker audio provided, but endpoint %s has no detectable audio parameter.",
            getattr(endpoint, "api_name", None),
        )

    return kwargs


# ═══════════════════════════════════════════════════════════════════════
# stream_speech — стрымінг аўдыя (абодва рэжымы)
# ═══════════════════════════════════════════════════════════════════════

async def stream_speech(
    text: str, speaker_audio_path: Optional[str] = None
) -> AsyncGenerator[bytes, None]:
    """
    Стрымінг аўдыя.
    • API mode  → BexttsAssist Gradio streaming
    • Local mode → local_xtts_service.stream_audio
    """
    if TTS_MODE == "api":
        async for chunk in _stream_speech_api(text, speaker_audio_path):
            yield chunk
    else:
        async for chunk in _stream_speech_local(text, speaker_audio_path):
            yield chunk


# ── API streaming ────────────────────────────────────────────────────

async def _stream_speech_api(
    text: str, speaker_audio_path: Optional[str] = None
) -> AsyncGenerator[bytes, None]:
    """Стрымінг аўдыя праз BexttsAssist Gradio API."""
    if not voice_client:
        log.error(
            "Voice client (BexttsAssist) is not initialized. Cannot stream."
        )
        return

    import queue
    import threading

    loop = asyncio.get_running_loop()

    log.info(
        f"API Streaming TTS. Text length: {len(text)}. "
        f"First 100 chars: {text[:100]}"
    )

    chunk_queue: queue.Queue = queue.Queue()
    SENTINEL_DONE = object()

    def producer_thread():
        try:
            audio_input = (
                handle_file(speaker_audio_path) if speaker_audio_path else None
            )
            job = voice_client.submit(
                text_input=text,
                speaker_audio=audio_input,
                api_name="/text_to_speech",
            )
            for result in job:
                chunk_queue.put(result)
        except Exception as e:
            log.error(f"BexttsAssist prediction error: {e}")
            traceback.print_exc()
        finally:
            chunk_queue.put(SENTINEL_DONE)

    t = threading.Thread(target=producer_thread, daemon=True)
    t.start()

    def _process_item(item):
        """Апрацоўвае адзін элемент з вынікаў Gradio (шлях або base64)."""
        if isinstance(item, str):
            audio_bytes = _read_audio_file_bytes(item)
            if audio_bytes:
                return audio_bytes

            audio_bytes = _download_audio_bytes(item)
            if audio_bytes:
                return audio_bytes

            audio_bytes = _decode_audio_base64(item)
            if audio_bytes:
                return audio_bytes
        elif isinstance(item, dict):
            for key in ("path", "name"):
                audio_bytes = _read_audio_file_bytes(item.get(key))
                if audio_bytes:
                    return audio_bytes

            audio_bytes = _decode_audio_base64(item.get("data"))
            if audio_bytes:
                return audio_bytes

            for key in ("url", "path", "name"):
                audio_bytes = _download_audio_bytes(item.get(key))
                if audio_bytes:
                    return audio_bytes

            log.warning(
                "Unsupported Gradio FileData payload: keys=%s",
                sorted(item.keys()),
            )
        else:
            log.warning("Unsupported TTS item type from Gradio: %s", type(item).__name__)
        return None

    while True:
        result = await loop.run_in_executor(None, chunk_queue.get)
        if result is SENTINEL_DONE:
            break

        items = result if isinstance(result, (list, tuple)) else [result]
        recognized_audio = False
        for item in items:
            audio_chunk = _process_item(item)
            if audio_chunk:
                recognized_audio = True
                log.info(f"Yielding API audio chunk ({len(audio_chunk)} bytes)")
                yield audio_chunk
        if not recognized_audio:
            log.warning(
                "Unrecognized TTS result from Gradio | result=%s | items=%s",
                _summarize_tts_item(result),
                [_summarize_tts_item(item) for item in items[:3]],
            )

    log.info("Finished API streaming TTS.")


# ── Local streaming ──────────────────────────────────────────────────

async def _stream_speech_local(
    text: str, speaker_audio_path: Optional[str] = None
) -> AsyncGenerator[bytes, None]:
    """Стрымінг аўдыя праз лакальны XTTS."""
    try:
        async for chunk in stream_audio(
            text, speaker_audio_path, yield_raw_pcm=True
        ):
            yield chunk
    except Exception as e:
        log.error(f"Error in local stream_speech: {e}")
        traceback.print_exc()


# ═══════════════════════════════════════════════════════════════════════
# stream_speech_multi — continuous multi-sentence TTS (no gaps)
# ═══════════════════════════════════════════════════════════════════════

async def stream_speech_multi(
    sentence_queue: asyncio.Queue,
    speaker_audio_path: Optional[str] = None,
    cancel_event=None,
) -> AsyncGenerator[bytes, None]:
    """
    Continuous TTS streaming from a queue of sentences.
    All sentences share ONE audio chunker — no gaps between sentences.

    For local mode: uses stream_audio_multi (single _chunker across sentences).
    For API mode: falls back to per-sentence streaming.

    Queue protocol: str items = text, None = stop sentinel.
    cancel_event: threading.Event — set to abort generation early.
    """
    if TTS_MODE == "local":
        from services.local_xtts_service import stream_audio_multi
        async for chunk in stream_audio_multi(
            sentence_queue, speaker_audio_path, yield_raw_pcm=True,
            cancel_event=cancel_event,
        ):
            yield chunk
    else:
        # API mode: per-sentence fallback (no local _chunker available)
        while True:
            if cancel_event and cancel_event.is_set():
                break
            sentence = await sentence_queue.get()
            if sentence is None:
                break
            sentence = sentence.strip()
            if not sentence:
                continue
            async for chunk in _stream_speech_api(sentence, speaker_audio_path):
                if cancel_event and cancel_event.is_set():
                    break
                yield chunk


# ═══════════════════════════════════════════════════════════════════════
# synthesize_speech — асноўная функцыя (абодва рэжымы)
# ═══════════════════════════════════════════════════════════════════════

async def synthesize_speech(
    text: str,
    speaker_audio_path: Optional[str] = None,
    tool_context: Optional[ToolContext] = None,
) -> types.Part:
    """
    Канвертуе тэкст у WAV-аўдыя.

    Parameters
    ----------
    text : str
        Тэкст, які трэба агучыць.
    speaker_audio_path : str | None
        Шлях да файла з прыкладам голасу (неабавязкова).
    tool_context : ToolContext
        Ін'ектуецца ADK; утрымлівае save_artifact / load_artifact.

    Returns
    -------
    types.Part
        Part, які ўтрымлівае толькі метаданыя артэфакта (без байтаў).
    """
    result_path: Optional[str] = None

    try:
        # ── Streaming path (абодва рэжымы) ──
        user_id = tool_context._invocation_context.user_id if tool_context and hasattr(tool_context, "_invocation_context") else None
        if user_id and user_id in voice_queues:
            # Для API-рэжыму дадаткова правяраем voice_client
            if TTS_MODE == "api" and not voice_client:
                log.warning("API voice_client not available for streaming.")
            else:
                log.info(f"Streaming TTS for user {user_id}")
                queue_obj, loop = voice_queues[user_id]

                async for chunk in stream_speech(text, speaker_audio_path):
                    if asyncio.get_running_loop() is loop:
                        await queue_obj.put(chunk)
                    else:
                        future = asyncio.run_coroutine_threadsafe(queue_obj.put(chunk), loop)
                        await asyncio.wrap_future(future)

                return types.Part(text="[Audio streamed directly]")

        # ── Standard (non-streaming) path ──
        if TTS_MODE == "api":
            result_path = await _synthesize_api(text, speaker_audio_path)
        else:
            result_path = await _synthesize_local(text, speaker_audio_path)

        if not result_path or not os.path.exists(result_path):
            raise ConnectionError("TTS did not produce a WAV file.")

        with open(result_path, "rb") as f:
            audio_bytes = f.read()

        audio_part = types.Part.from_bytes(
            data=audio_bytes, mime_type="audio/wav"
        )
        artifact_part = await tool_context.save_artifact(
            filename="tts_output.wav",
            artifact=audio_part,
        )

        return artifact_part

    except Exception as exc:  # pylint: disable=broad-except
        traceback.print_exc()
        return types.Part(
            text=f"Памылка пры сінтэзе маўлення ({TTS_MODE}): {exc!r}"
        )

    finally:
        if result_path and os.path.exists(result_path):
            try:
                os.remove(result_path)
            except OSError as exc:
                log.error(f"Не атрымалася выдаліць {result_path}: {exc}")


# ── API: non-streaming synthesis ─────────────────────────────────────

async def _synthesize_api(
    text: str, speaker_audio_path: Optional[str] = None
) -> Optional[str]:
    """Выклік Gradio TTS API і вяртанне шляху да WAV-файла."""
    loop = asyncio.get_running_loop()

    def _call():
        if speaker_audio_path and not os.path.exists(speaker_audio_path):
            raise FileNotFoundError(
                f"File for cloning not found: {speaker_audio_path}"
            )

        endpoint = _get_named_tts_endpoint(gradio_client)
        predict_kwargs = _build_tts_predict_kwargs(
            endpoint, text, speaker_audio_path
        )
        return gradio_client.predict(
            api_name=endpoint.api_name,
            **predict_kwargs,
        )

    return await loop.run_in_executor(None, _call)


# ── Local: non-streaming synthesis ───────────────────────────────────

async def _synthesize_local(
    text: str, speaker_audio_path: Optional[str] = None
) -> Optional[str]:
    """Лакальны XTTS: сінтэз у файл."""
    import tempfile

    fd, tmp_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)

    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(
        None, synthesize_to_file, text, tmp_path, speaker_audio_path
    )
    return result


# ═══════════════════════════════════════════════════════════════════════
# Рэгістрацыя ў ADK
# ═══════════════════════════════════════════════════════════════════════

synthesize_speech_tool = FunctionTool(func=synthesize_speech)
