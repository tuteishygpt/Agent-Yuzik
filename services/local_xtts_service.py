import os
import json
import time
import base64
import hashlib
import pathlib
import re
import struct
import logging
from dataclasses import dataclass
from typing import Iterator, Iterable, Optional, Tuple, List, AsyncGenerator
import asyncio

import numpy as np
import torch

log = logging.getLogger(__name__)

# Спроба імпартаваць TTS
try:
    from TTS.tts.configs.xtts_config import XttsConfig
    from TTS.tts.models.xtts import Xtts
    from TTS.tts.layers.xtts.tokenizer import split_sentence, VoiceBpeTokenizer
    HAS_TTS = True
except ImportError:
    HAS_TTS = False
    log.warning("TTS library is not installed. XTTS local service will not work.")
    def split_sentence(text, lang, text_split_length):
        return [text]

# ---- Канфіг стрыму ----
INITIAL_MIN_BUFFER_S = 0.10
MIN_BUFFER_S        = 0.05
FADE_S              = 0.005
ENABLE_TEXT_SPLITTING = True
FIRST_SEGMENT_LIMIT = 80

device = globals().get("device", "cuda:0" if torch.cuda.is_available() else "cpu")
sampling_rate = int(globals().get("sampling_rate", 24000))
default_voice_file = globals().get("default_voice_file", None)
repo_id = globals().get("repo_id", "archivartaunik/BE_XTTS_V2_10ep250k")

# ---- Глабальныя зменныя мадэлі ----
XTTS_MODEL = None

PERSIST_LATENTS_DIR = pathlib.Path("./latents_cache")
PERSIST_LATENTS_DIR.mkdir(parents=True, exist_ok=True)

@dataclass(frozen=True)
class LatentsMeta:
    model_id: str
    gpt_cond_len: int
    max_ref_len: int
    sound_norm_refs: bool

LATENT_CACHE: dict[str, Tuple[torch.Tensor, torch.Tensor]] = {}
GPU_LATENT_CACHE: dict[Tuple[str, str], Tuple[torch.Tensor, torch.Tensor]] = {}


def load_model(hf_repo_id: str = repo_id, target_model_dir: str = "./model"):
    """Запампоўвае або загружае мадэль з лакальнай дырэкторыі."""
    global XTTS_MODEL, default_voice_file, sampling_rate
    if XTTS_MODEL is not None:
        return XTTS_MODEL
    if not HAS_TTS:
        raise ImportError("Please install TTS package: pip install TTS")

    log.info(f"Загрузка лакальнай мадэлі XTTS (прылада: {device})...")
    from huggingface_hub import hf_hub_download

    os.makedirs(target_model_dir, exist_ok=True)
    checkpoint_file = os.path.join(target_model_dir, "model.pth")
    config_file = os.path.join(target_model_dir, "config.json")
    vocab_file = os.path.join(target_model_dir, "vocab.json")
    local_voice_file = os.path.join(target_model_dir, "voice.wav")

    for fname in ("model.pth", "config.json", "vocab.json", "voice.wav"):
        fpath = os.path.join(target_model_dir, fname)
        if not os.path.exists(fpath):
            log.info(f"Сцягваем файл {fname}...")
            hf_hub_download(hf_repo_id, filename=fname, local_dir=target_model_dir)

    config = XttsConfig()
    config.load_json(config_file)
    XTTS_MODEL = Xtts.init_from_config(config)
    XTTS_MODEL.load_checkpoint(
        config,
        checkpoint_path=checkpoint_file,
        vocab_path=vocab_file,
        use_deepspeed=False,
    )

    torch.set_num_threads(1)
    if device.startswith("cuda"):
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
        torch.backends.cudnn.benchmark = True
        try:
            torch.set_float32_matmul_precision("high")
        except Exception:
            pass

    XTTS_MODEL.to(device).eval()
    sampling_rate = int(XTTS_MODEL.config.audio["sample_rate"])

    tokenizer = VoiceBpeTokenizer(vocab_file=vocab_file)
    XTTS_MODEL.tokenizer = tokenizer

    if not default_voice_file:
        default_voice_file = local_voice_file

    log.info("Лакальная мадэль XTTS паспяхова загружана!")
    return XTTS_MODEL


def _latents_key(path: str | None, meta: LatentsMeta) -> str:
    base = (
        f"{os.path.abspath(path)}:{os.path.getmtime(path)}:{os.path.getsize(path)}"
        if path and os.path.exists(path) else "default_voice"
    )
    return hashlib.md5((base + "|" + json.dumps(meta.__dict__, sort_keys=True)).encode("utf-8")).hexdigest()


def _latents_for(path: str | None, *, to_device: Optional[str] = None) -> Tuple[torch.Tensor, torch.Tensor]:
    if XTTS_MODEL is None:
        raise RuntimeError("Мадэль не загружана. Выклічце load_model().")
    cfg = XTTS_MODEL.config
    meta = LatentsMeta(
        model_id=repo_id,
        gpt_cond_len=cfg.gpt_cond_len,
        max_ref_len=cfg.max_ref_len,
        sound_norm_refs=cfg.sound_norm_refs,
    )
    key = _latents_key(path, meta)
    g, s = LATENT_CACHE.get(key) or (None, None)
    if g is None:
        disk_path = PERSIST_LATENTS_DIR / f"{key}.pt"
        if disk_path.exists():
            data = torch.load(disk_path, map_location="cpu")
            g, s = data["gpt_cond_latent"], data["speaker_embedding"]
        else:
            log.info(f"Разлік латэнтаў для {path or 'стандартнага голасу'}...")
            with torch.inference_mode():
                g_cpu, s_cpu = XTTS_MODEL.get_conditioning_latents(audio_path=path)
            g, s = g_cpu.cpu(), s_cpu.cpu()
            torch.save({"gpt_cond_latent": g, "speaker_embedding": s}, disk_path)
            log.info("Латэнты захаваны ў кэш.")
        LATENT_CACHE[key] = (g, s)
    if to_device:
        dev_key = (key, to_device)
        if dev_key in GPU_LATENT_CACHE:
            return GPU_LATENT_CACHE[dev_key]
        g, s = g.to(to_device, non_blocking=True), s.to(to_device, non_blocking=True)
        GPU_LATENT_CACHE[dev_key] = (g, s)
    return g, s


try:
    if default_voice_file:
        _latents_for(default_voice_file, to_device=device)
        log.info("Стандартны голас паспяхова пракэшаваны.")
except Exception as e:
    log.warning(f"Папярэджанне: не атрымалася папярэдне кэшаваць стандартны голас: {e}")

def _to_np_audio(x) -> np.ndarray:
    if isinstance(x, dict) and "wav" in x:
        x = x["wav"]
    if isinstance(x, torch.Tensor):
        x = x.detach().cpu().float().contiguous().view(-1).numpy()
    x = np.asarray(x, dtype=np.float32)
    return x.reshape(-1)


def _seconds_to_samples(sec: float, sr: int) -> int:
    return max(1, int(sec * sr))


def _chunker(chunks: Iterable[np.ndarray], sr: int, initial_target_s: float, target_s: float) -> Iterator[np.ndarray]:
    is_first = True
    target_samples = _seconds_to_samples(initial_target_s, sr)
    min_first = _seconds_to_samples(0.06, sr)
    min_next  = _seconds_to_samples(0.05, sr)
    buffer = np.array([], dtype=np.float32)
    for c_np in map(_to_np_audio, chunks):
        if c_np.size == 0:
            continue
        buffer = np.concatenate([buffer, c_np])
        need = target_samples if buffer.size < target_samples else 0
        if buffer.size >= max(min_first if is_first else min_next, need):
            yield buffer
            buffer = np.array([], dtype=np.float32)
            if is_first:
                is_first = False
                target_samples = _seconds_to_samples(target_s, sr)
    if buffer.size > 0:
        yield buffer


# ---- Падзел тэксту ----
_SENT_END = re.compile(r"([\.!\?…]+[»\")\\]]*\s+)")
_WS = re.compile(r"\s+")

def _fast_split(text: str, limit: int) -> List[str]:
    text = text.strip()
    if not text:
        return []
    parts, start = [], 0
    for m in _SENT_END.finditer(text):
        end = m.end()
        parts.append(text[start:end].strip())
        start = end
    if start < len(text):
        parts.append(text[start:].strip())
    chunks, cur = [], ""
    for s in parts:
        if len(cur) + 1 + len(s) <= limit:
            cur = (cur + " " + s).strip() if cur else s
        else:
            if cur:
                chunks.append(cur)
            if len(s) <= limit:
                cur = s
            else:
                w = _WS.split(s); acc = ""
                for tok in w:
                    if len(acc) + 1 + len(tok) <= limit:
                        acc = (acc + " " + tok).strip() if acc else tok
                    else:
                        if acc:
                            chunks.append(acc)
                        acc = tok
                cur = acc or ""
    if cur:
        chunks.append(cur)
    return [c for c in chunks if c]


def _split_text_smart(text_in: str, lang_short: str, chunk_limit: int) -> List[str]:
    text_in = text_in.strip()
    if not text_in:
        return []
    parts: List[str] = []
    if len(text_in) > FIRST_SEGMENT_LIMIT:
        head = text_in[:FIRST_SEGMENT_LIMIT]
        m = re.search(r".*[\.!\?…»)]", head)
        if m and len(m.group(0)) > 30:
            head = m.group(0)
        tail = text_in[len(head):].lstrip()
        parts.append(head)
        text_for_rest = tail
    else:
        text_for_rest = text_in
    if not text_for_rest:
        return parts or [text_in]
    rest = _fast_split(text_for_rest, chunk_limit)
    if not rest or sum(len(x) for x in rest) < int(0.6 * len(text_for_rest)):
        try:
            rest2 = split_sentence(text_for_rest, lang=lang_short, text_split_length=chunk_limit)
            rest2 = [s.strip() for s in rest2 if s and s.strip()]
            if rest2:
                rest = rest2
        except Exception:
            pass
    return parts + (rest or [text_for_rest])


def _add_wav_header(pcm_data: bytes, sample_rate: int = 24000, channels: int = 1) -> bytes:
    """Add WAV header to raw PCM data (Float32)."""
    byte_count = len(pcm_data)
    header = struct.pack('<4sI4s4sIHHIIHH4sI',
        b'RIFF', byte_count + 36, b'WAVE',
        b'fmt ', 16, 3, channels, sample_rate,
        sample_rate * channels * 4, channels * 4, 32,
        b'data', byte_count
    )
    return header + pcm_data


async def stream_audio(
    text_input: str,
    speaker_audio: Optional[str] = None,
    initial_buffer_s: float = INITIAL_MIN_BUFFER_S,
    subsequent_buffer_s: float = MIN_BUFFER_S,
    yield_raw_pcm: bool = False
) -> AsyncGenerator[bytes, None]:
    """
    Асінхронны генератар для лакальнага стрымінгу аўдыя з мадэлі XTTS.
    Уключае дэталёвыя таймінгі на кожным этапе.
    """
    import queue
    import threading

    t_pipeline = time.perf_counter()

    # ── Load model if needed ──
    if XTTS_MODEL is None:
        t0 = time.perf_counter()
        load_model()
        log.info(f"[TTS·TIMING] Model load: {(time.perf_counter()-t0)*1000:.1f} ms")

    if not text_input or not text_input.strip():
        return

    log.info(f"[TTS·TIMING] ── Pipeline start ── text={len(text_input)} chars")

    # ── Latents ──
    t0 = time.perf_counter()
    gpt_cond_latent, speaker_embedding = _latents_for(
        speaker_audio or default_voice_file,
        to_device=device,
    )
    log.info(f"[TTS·TIMING] Latents: {(time.perf_counter()-t0)*1000:.1f} ms (cached)")

    # ── Text split ──
    t0 = time.perf_counter()
    char_limit_cfg = getattr(XTTS_MODEL, "tokenizer", None)
    be_limit = 250
    if char_limit_cfg and hasattr(char_limit_cfg, "char_limits"):
        be_limit = char_limit_cfg.char_limits.get("be", 250)
    char_limit = min(180, be_limit)
    texts = _split_text_smart(text_input.strip(), "be", char_limit) if ENABLE_TEXT_SPLITTING else [text_input.strip()]
    log.info(f"[TTS·TIMING] Text split: {(time.perf_counter()-t0)*1000:.1f} ms | "
             f"segments={len(texts)} | lengths={[len(t) for t in texts]}")

    # ── Sync generator with timing ──
    def sync_generator():
        t_inf = time.perf_counter()
        first = True
        count = 0
        total_samples = 0

        with torch.inference_mode(), torch.autocast(
            device_type="cuda",
            dtype=torch.float16,
            enabled=str(device).startswith("cuda"),
        ):
            raw_chunks = (
                _to_np_audio(chunk)
                for part in texts
                for chunk in XTTS_MODEL.inference_stream(
                    text=part,
                    language="be",
                    gpt_cond_latent=gpt_cond_latent,
                    speaker_embedding=speaker_embedding,
                    temperature=0.15,
                    length_penalty=0.9,
                    repetition_penalty=7.0,
                    top_k=5,
                    top_p=0.75,
                    enable_text_splitting=False,
                )
            )

            for audio_chunk in _chunker(raw_chunks, sampling_rate, initial_buffer_s, subsequent_buffer_s):
                count += 1
                n = len(audio_chunk)
                total_samples += n
                ms = n / sampling_rate * 1000
                elapsed = (time.perf_counter() - t_inf) * 1000

                if first:
                    log.info(f"[TTS·TIMING] 🎵 1st chunk: inference={elapsed:.1f} ms | "
                             f"total_from_start={(time.perf_counter()-t_pipeline)*1000:.1f} ms | "
                             f"audio={ms:.0f} ms ({n} samples)")
                    first = False
                else:
                    log.debug(f"[TTS·TIMING] Chunk #{count}: {ms:.0f} ms | elapsed={elapsed:.0f} ms")
                yield audio_chunk

        total_audio = total_samples / sampling_rate * 1000
        log.info(f"[TTS·TIMING] ✅ Done: inference={(time.perf_counter()-t_inf)*1000:.0f} ms | "
                 f"chunks={count} | audio={total_audio:.0f} ms | "
                 f"pipeline={(time.perf_counter()-t_pipeline)*1000:.0f} ms")

    # ── Producer thread + async queue ──
    loop = asyncio.get_running_loop()
    q = queue.Queue()
    SENTINEL = object()

    t_thread = time.perf_counter()

    def producer():
        try:
            for chunk in sync_generator():
                q.put(chunk)
        except Exception as e:
            log.error(f"Error in local XTTS inference: {e}")
        finally:
            q.put(SENTINEL)

    threading.Thread(target=producer, daemon=True).start()

    idx = 0
    while True:
        t_wait = time.perf_counter()
        chunk = await loop.run_in_executor(None, q.get)
        if chunk is SENTINEL:
            break

        idx += 1
        wait_ms = (time.perf_counter() - t_wait) * 1000
        if idx == 1:
            log.info(f"[TTS·TIMING] Queue→async 1st chunk: wait={wait_ms:.1f} ms | "
                     f"thread_overhead={(time.perf_counter()-t_thread)*1000:.1f} ms")
        elif idx <= 3:
            log.debug(f"[TTS·TIMING] Queue→async #{idx}: wait={wait_ms:.1f} ms")

        bytes_data = chunk.tobytes()
        if yield_raw_pcm:
            yield bytes_data
        else:
            yield _add_wav_header(bytes_data, sample_rate=sampling_rate, channels=1)


def synthesize_to_file(
    text_input: str,
    output_path: str,
    speaker_audio: Optional[str] = None
) -> str:
    """Нестрымінгавая генерацыя ўсяго тэксту і захаванне яго ў адзіны WAV-файл."""
    if XTTS_MODEL is None:
        load_model()
    if not text_input or not text_input.strip():
        raise ValueError("Тэкст пусты")
    gpt_cond_latent, speaker_embedding = _latents_for(
        speaker_audio or default_voice_file,
        to_device=device,
    )
    log.info(f"Сінтэз у файл для тэксту даўжынёй {len(text_input)} сімвалаў...")
    with torch.inference_mode(), torch.autocast(
        device_type="cuda",
        dtype=torch.float16,
        enabled=str(device).startswith("cuda"),
    ):
        out = XTTS_MODEL.synthesize(
            text=text_input.strip(),
            config=XTTS_MODEL.config,
            speaker_wav=speaker_audio or default_voice_file,
            language="be",
            gpt_cond_latent=gpt_cond_latent,
            speaker_embedding=speaker_embedding,
            temperature=0.25,
            length_penalty=0.9,
            repetition_penalty=7.0,
            top_k=10,
            top_p=0.80,
        )
    audio_np = _to_np_audio(out["wav"])
    bytes_data = audio_np.tobytes()
    wav_bytes = _add_wav_header(bytes_data, sample_rate=sampling_rate, channels=1)
    with open(output_path, "wb") as f:
        f.write(wav_bytes)
    log.info(f"Файл паспяхова захаваны ў: {output_path}")
    return output_path
