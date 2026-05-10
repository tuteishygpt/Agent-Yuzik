import os
import json
import time
import base64
import hashlib
import pathlib
import re
import struct
import logging
import threading
from dataclasses import dataclass
from typing import Iterator, Iterable, Optional, Tuple, List, AsyncGenerator
import queue as stdlib_queue
import asyncio

import numpy as np
import torch

log = logging.getLogger(__name__)
import config as app_config

# Спроба імпартаваць TTS
try:
    from TTS.tts.configs.xtts_config import XttsConfig
    from TTS.tts.models.xtts import Xtts
    from TTS.tts.layers.xtts.tokenizer import split_sentence, VoiceBpeTokenizer
    HAS_TTS = True
except ImportError:
    HAS_TTS = False
    log.warning("TTS library is not installed. XTTS local service will not work.")
    def split_sentence(text, lang, text_split_length, min_chunk_length=40):
        return [text]

# ---- Канфіг стрыму (з config.py / .env) ----
INITIAL_MIN_BUFFER_S = getattr(app_config, 'TTS_INITIAL_BUFFER_S', 0.20)
MIN_BUFFER_S        = getattr(app_config, 'TTS_MIN_BUFFER_S', 0.15)
FADE_S              = 0.005
ENABLE_TEXT_SPLITTING = False
# Max audio duration per character (seconds). XTTS hallucinations produce
# vastly more audio than the text warrants — cut them off early.
_MAX_AUDIO_S_PER_CHAR = 0.15  # ~150ms/char ≈ generous upper bound for Belarusian
_MIN_MAX_AUDIO_S = 5.0        # absolute floor so ultra-short texts aren't clipped
FIRST_SEGMENT_LIMIT = getattr(app_config, 'TTS_FIRST_SEGMENT_LIMIT', 80)

device = globals().get("device", "cuda:0" if torch.cuda.is_available() else "cpu")
sampling_rate = int(globals().get("sampling_rate", 24000))
default_voice_file = globals().get("default_voice_file", None)
repo_id = globals().get("repo_id", "archivartaunik/BE_XTTS_V2_10ep250k")

# GPU / AMP — auto-detect BF16 support (Ampere+: A100, L4, T4 etc.)
use_cuda = torch.cuda.is_available()
use_bf16 = False # torch.cuda.is_bf16_supported() 
amp_dtype = torch.float16
log.info(f"AMP dtype: {amp_dtype} (bf16_supported={use_bf16}, device={device})")

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
GPU_LATENT_CACHE: dict[Tuple[str, str, str], Tuple[torch.Tensor, torch.Tensor]] = {}

_inference_lock = threading.Lock()
_load_model_lock = threading.Lock()

GLOBAL_GPU_QUEUE = stdlib_queue.Queue()

@dataclass
class TTSJob:
    text: str
    gpt_cond_latent: torch.Tensor
    speaker_embedding: torch.Tensor
    cancel_event: Optional[threading.Event]
    raw_out_q: stdlib_queue.Queue
    session_id: str
    seg_idx: int
    temperature: float
    top_k: int
    top_p: float

def _gpu_worker_loop():
    log.info("Starting global GPU worker thread for XTTS")
    while True:
        try:
            job: TTSJob = GLOBAL_GPU_QUEUE.get()
        except Exception:
            break
            
        if job is None:
            break
            
        if job.cancel_event and job.cancel_event.is_set():
            job.raw_out_q.put(None)
            continue
            
        try:
            with torch.inference_mode(), torch.autocast(
                device_type="cuda",
                dtype=amp_dtype,
                enabled=str(device).startswith("cuda"),
            ):
                with _inference_lock:
                    if job.cancel_event and job.cancel_event.is_set():
                        job.raw_out_q.put(None)
                        continue
                        
                    max_samples = int(
                        max(len(job.text) * _MAX_AUDIO_S_PER_CHAR, _MIN_MAX_AUDIO_S)
                        * sampling_rate
                    )
                    total_samples = 0

                    for chunk in XTTS_MODEL.inference_stream(
                        text=job.text,
                        language="be",
                        gpt_cond_latent=job.gpt_cond_latent,
                        speaker_embedding=job.speaker_embedding,
                        temperature=job.temperature,
                        length_penalty=0.9,
                        repetition_penalty=7.0,
                        top_k=job.top_k,
                        top_p=job.top_p,
                        enable_text_splitting=False,
                    ):
                        c_np = _to_np_audio(chunk)
                        if c_np.size > 0:
                            total_samples += c_np.size
                            job.raw_out_q.put(c_np)

                        if total_samples > max_samples:
                            expected_ms = max_samples / sampling_rate * 1000
                            actual_ms = total_samples / sampling_rate * 1000
                            log.warning(
                                f"[GPU Worker] ⚠️ Hallucination guard: seg #{job.seg_idx} "
                                f"exceeded {expected_ms:.0f}ms limit ({actual_ms:.0f}ms generated "
                                f"for {len(job.text)} chars). Cutting off."
                            )
                            break

                        if job.cancel_event and job.cancel_event.is_set():
                            log.info(f"[GPU Worker] Cancel mid-inference seg #{job.seg_idx}, releasing GPU")
                            break
        except Exception as e:
            log.error(f"Error in global GPU worker: {e}", exc_info=True)
            
        job.raw_out_q.put(None)

_gpu_worker_thread_obj = threading.Thread(target=_gpu_worker_loop, daemon=True)
_gpu_worker_thread_obj.start()


def load_model(hf_repo_id: str = repo_id, target_model_dir: str = "./model"):
    """Запампоўвае або загружае мадэль з лакальнай дырэкторыі."""
    global XTTS_MODEL, default_voice_file, sampling_rate
    if XTTS_MODEL is not None:
        return XTTS_MODEL
        
    with _load_model_lock:
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
        model = Xtts.init_from_config(config)
        model.load_checkpoint(
            config,
            checkpoint_path=checkpoint_file,
            vocab_path=vocab_file,
            use_deepspeed=False,
        )

        torch.set_num_threads(1)
        if device.startswith("cuda"):
            torch.backends.cuda.matmul.allow_tf32 = True
            torch.backends.cudnn.allow_tf32 = True
            torch.backends.cudnn.benchmark = True   # find optimal algo for repeated inference
            try:
                torch.set_float32_matmul_precision("high")
            except Exception:
                pass

        model.to(device).eval()
        sampling_rate = int(model.config.audio["sample_rate"])

        tokenizer = VoiceBpeTokenizer(vocab_file=vocab_file)
        model.tokenizer = tokenizer

        if not default_voice_file:
            default_voice_file = local_voice_file

        XTTS_MODEL = model
        log.info("Лакальная мадэль XTTS паспяхова загружана!")
        return XTTS_MODEL


def _latents_key(path: str | None, meta: LatentsMeta) -> str:
    base = (
        f"{os.path.abspath(path)}:{os.path.getmtime(path)}:{os.path.getsize(path)}"
        if path and os.path.exists(path) else "default_voice"
    )
    return hashlib.md5((base + "|" + json.dumps(meta.__dict__, sort_keys=True)).encode("utf-8")).hexdigest()


def _latents_for(path: str | None, *, to_device: Optional[str] = None) -> Tuple[torch.Tensor, torch.Tensor]:
    with _inference_lock:
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
            dev_key = (key, to_device, "bf16" if amp_dtype is torch.bfloat16 else "fp16")
            if dev_key in GPU_LATENT_CACHE:
                return GPU_LATENT_CACHE[dev_key]
            g = g.to(to_device, non_blocking=True)
            s = s.to(to_device, non_blocking=True)
            # Cast latents to match autocast precision — saves GPU memory & avoids cast at inference
            if str(to_device).startswith("cuda"):
                g = g.to(amp_dtype)
                s = s.to(amp_dtype)
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
    """Buffer raw TTS chunks and yield fixed-size audio chunks.

    Uses a deque of arrays instead of np.concatenate-per-chunk to avoid
    O(n) full-buffer copies on every incoming raw chunk.
    """
    from collections import deque

    is_first = True
    target_samples = _seconds_to_samples(initial_target_s, sr)
    buf: deque[np.ndarray] = deque()
    buf_size = 0  # total samples in buf

    for c_np in map(_to_np_audio, chunks):
        if c_np.size == 0:
            continue
        buf.append(c_np)
        buf_size += c_np.size

        while buf_size >= target_samples:
            # Materialise exactly target_samples from the deque
            out_parts: list[np.ndarray] = []
            need = target_samples
            while need > 0 and buf:
                head = buf[0]
                if head.size <= need:
                    out_parts.append(head)
                    need -= head.size
                    buf_size -= head.size
                    buf.popleft()
                else:
                    out_parts.append(head[:need])
                    buf[0] = head[need:]
                    buf_size -= need
                    need = 0
            yield np.concatenate(out_parts) if len(out_parts) > 1 else out_parts[0]
            if is_first:
                is_first = False
                target_samples = _seconds_to_samples(target_s, sr)

    # Yield remainder
    if buf_size > 0:
        remaining = list(buf)
        yield np.concatenate(remaining) if len(remaining) > 1 else remaining[0]



# ---- Падзел тэксту ----
_SENT_END = re.compile(r"([\.!\?…]+[»\")\\]]*\s+)")
_WS = re.compile(r"\s+")
_SENT_DELIM = re.compile(r'([.!?…]+[»\"\)\]]*)\s+')


def _split_into_sentences(text: str) -> List[str]:
    """Разбівае тэкст на асобныя сказы па межах .!?…"""
    text = text.strip()
    if not text:
        return []
    tokens = _SENT_DELIM.split(text)
    sentences: List[str] = []
    i = 0
    while i < len(tokens):
        part = tokens[i]
        if i + 1 < len(tokens):
            part += tokens[i + 1]   # далучыць знак прыпынку да папярэдняга сказа
            i += 2
        else:
            i += 1
        part = part.strip()
        if part:
            sentences.append(part)
    return sentences


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
    """
    Разумны падзел тэксту для TTS стрымінгу:
    - Спачатку робяцца астатнія апрацоўкі з tokenizer.py (выклік preprocess_text: лічбы, абрэвіятуры і г.д.)
    - Першы сегмент: кароткі (першы сказ) для хуткага старту аўдыя
    - Наступныя сегменты: разбіваюцца праз арыгінальны split_sentence з tokenizer.py
    """
    text_in = text_in.strip()
    if not text_in:
        return []

    # 0) Выкарыстоўваем астатнія апрацоўкі з tokenizer.py (калі мадэль і яе такенізатар загружаныя)
    global XTTS_MODEL
    if XTTS_MODEL is not None and hasattr(XTTS_MODEL, "tokenizer") and XTTS_MODEL.tokenizer is not None:
        text_in = XTTS_MODEL.tokenizer.preprocess_text(text_in, lang_short)

    # 1) Разбіваем увесь тэкст на сказы, каб вылучыць самы хуткі першы сказ
    sentences = _split_into_sentences(text_in)
    if not sentences:
        return [text_in]

    # 2) Першы сегмент — першы сказ (для хуткага старту)
    head = sentences[0]
    rest = list(sentences[1:])

    # Калі першы сказ вельмі доўгі — шукаем натуральную мяжу (коска, кропка з коскай, працяжнік)
    if len(head) > FIRST_SEGMENT_LIMIT and FIRST_SEGMENT_LIMIT > 0:
        search_zone = head[:FIRST_SEGMENT_LIMIT + 40]
        brk = re.search(r'.{30,}?[,;:–—]\s', search_zone)
        if brk:
            cut = brk.end()
            leftover = head[cut:].strip()
            head = head[:cut].strip()
            if leftover:
                rest.insert(0, leftover)
        # інакш — бярэм увесь першы сказ

    result = [head]

    # 3) Астатнія сказы перадаём у арыгінальную split_sentence
    rest_text = " ".join(rest).strip()
    if rest_text:
        # split_sentence ўжо імпартаваная на пачатку файла
        chunks = split_sentence(rest_text, lang_short, text_split_length=chunk_limit, min_chunk_length=40)
        result.extend(chunks)

    return result


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
    char_limit = min(250, be_limit)
    texts = _split_text_smart(text_input.strip(), "be", char_limit) if ENABLE_TEXT_SPLITTING else [text_input.strip()]
    log.info(f"[TTS·TIMING] Text split: {(time.perf_counter()-t0)*1000:.1f} ms | "
             f"segments={len(texts)} | lengths={[len(t) for t in texts]}")

    # ── Sync generator with timing ──
    def _raw_inference_gen():
        """Yields raw np.ndarray chunks from per-segment inference with per-segment timing."""
        segment_idx = 0
        session_id = str(id(texts))

        for part in texts:
            segment_idx += 1
            t_seg = time.perf_counter()
            seg_chunks = 0
            seg_samples = 0
            
            log.info(f"[TTS·TIMING] ▶ Segment #{segment_idx}/{len(texts)} submitted to global queue: "
                     f"{len(part)} chars | «{part[:60]}»")

            raw_out_q = stdlib_queue.Queue()
            
            job = TTSJob(
                text=part,
                gpt_cond_latent=gpt_cond_latent,
                speaker_embedding=speaker_embedding,
                cancel_event=None,
                raw_out_q=raw_out_q,
                session_id=session_id,
                seg_idx=segment_idx,
                temperature=getattr(app_config, 'TTS_TEMPERATURE', 0.15),
                top_k=getattr(app_config, 'TTS_TOP_K', 5),
                top_p=getattr(app_config, 'TTS_TOP_P', 0.75),
            )
            
            GLOBAL_GPU_QUEUE.put(job)
            
            first_seg_chunk = True
            
            while True:
                c_np = raw_out_q.get()
                if c_np is None:
                    break
                    
                seg_chunks += 1
                seg_samples += c_np.size
                if first_seg_chunk:
                    seg_first_ms = (time.perf_counter() - t_seg) * 1000
                    log.info(f"[TTS·TIMING]   Seg #{segment_idx} 1st raw chunk (from worker): "
                             f"{seg_first_ms:.1f} ms | {c_np.size} samples")
                    first_seg_chunk = False
                yield c_np

            seg_ms = (time.perf_counter() - t_seg) * 1000
            seg_audio_ms = seg_samples / sampling_rate * 1000
            log.info(f"[TTS·TIMING] ◼ Segment #{segment_idx} done: "
                     f"{seg_chunks} raw chunks | {seg_ms:.0f} ms inference | "
                     f"{seg_audio_ms:.0f} ms audio")

    def sync_generator():
        """Wraps raw inference chunks through _chunker for proper buffering."""
        t_inf = time.perf_counter()
        first = True
        count = 0
        total_samples = 0

        for audio_chunk in _chunker(_raw_inference_gen(), sampling_rate, initial_buffer_s, subsequent_buffer_s):
            count += 1
            n = len(audio_chunk)
            total_samples += n
            ms = n / sampling_rate * 1000
            elapsed = (time.perf_counter() - t_inf) * 1000

            if first:
                log.info(f"[TTS·TIMING] 🎵 1st buffered chunk: inference={elapsed:.1f} ms | "
                         f"total_from_start={(time.perf_counter()-t_pipeline)*1000:.1f} ms | "
                         f"audio={ms:.0f} ms ({n} samples)")
                first = False
            elif count <= 3:
                log.info(f"[TTS·TIMING] Chunk #{count}: {ms:.0f} ms audio | elapsed={elapsed:.0f} ms")
            yield audio_chunk

        total_audio = total_samples / sampling_rate * 1000
        total_inf = (time.perf_counter() - t_inf) * 1000
        rtf = total_inf / total_audio if total_audio > 0 else 0
        log.info(f"[TTS·TIMING] ✅ Done: inference={total_inf:.0f} ms | "
                 f"chunks={count} | audio={total_audio:.0f} ms | "
                 f"RTF={rtf:.2f}x | "
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
    total_wait = 0
    total_tobytes = 0
    while True:
        t_wait = time.perf_counter()
        chunk = await loop.run_in_executor(None, q.get)
        if chunk is SENTINEL:
            break

        idx += 1
        wait_ms = (time.perf_counter() - t_wait) * 1000
        total_wait += wait_ms

        t_conv = time.perf_counter()
        bytes_data = chunk.tobytes()
        conv_ms = (time.perf_counter() - t_conv) * 1000
        total_tobytes += conv_ms

        if idx == 1:
            log.info(f"[TTS·TIMING] Queue→async 1st chunk: wait={wait_ms:.1f} ms | "
                     f"tobytes={conv_ms:.2f} ms | "
                     f"thread_overhead={(time.perf_counter()-t_thread)*1000:.1f} ms")
        elif idx <= 3 or wait_ms > 50:
            log.info(f"[TTS·TIMING] Queue→async #{idx}: wait={wait_ms:.1f} ms | "
                     f"tobytes={conv_ms:.2f} ms")

        if yield_raw_pcm:
            yield bytes_data
        else:
            yield _add_wav_header(bytes_data, sample_rate=sampling_rate, channels=1)

    log.info(f"[TTS·TIMING] Queue→async final: {idx} chunks | "
             f"total_wait={total_wait:.0f} ms | total_tobytes={total_tobytes:.1f} ms | "
             f"pipeline={(time.perf_counter()-t_pipeline)*1000:.0f} ms")


async def stream_audio_multi(
    sentence_queue: asyncio.Queue,
    speaker_audio: Optional[str] = None,
    initial_buffer_s: float = INITIAL_MIN_BUFFER_S,
    subsequent_buffer_s: float = MIN_BUFFER_S,
    yield_raw_pcm: bool = False,
    cancel_event: Optional[threading.Event] = None,
) -> AsyncGenerator[bytes, None]:
    """
    Continuous TTS streaming from an asyncio.Queue of sentences.

    Unlike stream_audio() which handles one text at a time (each with its own
    _chunker and producer thread), this function consumes ALL sentences from
    a queue and processes them through a SINGLE _chunker — eliminating gaps
    between sentences.

    This matches the reference Colab code pattern:
        all_chunks = (_to_np_audio(c) for part in texts
                      for c in XTTS_MODEL.inference_stream(text=part, ...))
        for chunk in _chunker(all_chunks, sr, initial_s, subsequent_s): ...

    Queue protocol:
      - str items  = sentences to synthesize
      - None       = sentinel to stop
    """
    import queue as stdlib_queue
    import threading

    t_pipeline = time.perf_counter()

    # ── Load model if needed ──
    if XTTS_MODEL is None:
        t0 = time.perf_counter()
        load_model()
        log.info(f"[TTS·TIMING] Model load: {(time.perf_counter()-t0)*1000:.1f} ms")

    log.info("[TTS·TIMING] ── Multi-sentence pipeline start ──")

    # ── Latents (cached) ──
    t0 = time.perf_counter()
    gpt_cond_latent, speaker_embedding = _latents_for(
        speaker_audio or default_voice_file,
        to_device=device,
    )
    log.info(f"[TTS·TIMING] Latents: {(time.perf_counter()-t0)*1000:.1f} ms (cached)")

    loop = asyncio.get_running_loop()

    # Bridge: async sentence_queue → sync stdlib queue
    sync_sentence_q: stdlib_queue.Queue = stdlib_queue.Queue()
    audio_out_q: stdlib_queue.Queue = stdlib_queue.Queue()
    SENTINEL = object()

    # Async forwarder: moves sentences from asyncio.Queue to sync queue
    async def _forward_sentences():
        try:
            while True:
                sentence = await sentence_queue.get()
                sync_sentence_q.put(sentence)
                if sentence is None:
                    break
        except asyncio.CancelledError:
            # Unblock producer thread waiting on sync_sentence_q.get()
            sync_sentence_q.put(None)
            raise

    forwarder_task = asyncio.create_task(_forward_sentences())

    def producer():
        """
        Sync thread: reads sentences from sync_sentence_q,
        submits TTSJobs to GLOBAL_GPU_QUEUE, feeds ALL raw chunks
        from the job's raw_out_q through ONE _chunker, puts buffered
        chunks to audio_out_q.
        """
        try:
            session_id = str(id(sync_sentence_q))
            
            # Queue of (seg_idx, raw_out_q, t_seg) for jobs already submitted to GPU.
            # The prefetch thread fills it; _continuous_raw_gen drains it.
            _job_q: stdlib_queue.Queue = stdlib_queue.Queue()

            def _prefetch_thread():
                """Read sentences, submit TTSJobs to GPU ahead of time.

                This runs in its own thread so that jobs land in
                GLOBAL_GPU_QUEUE *before* the current segment finishes,
                eliminating the GPU idle gap between segments.
                """
                seg_idx = 0
                try:
                    while True:
                        if cancel_event and cancel_event.is_set():
                            break
                        try:
                            text = sync_sentence_q.get(timeout=0.5)
                        except stdlib_queue.Empty:
                            continue
                        if text is None:
                            break
                        text = text.strip()
                        if not text:
                            continue

                        seg_idx += 1
                        t_seg = time.perf_counter()
                        log.info(
                            f"[TTS·TIMING] ▶ Multi seg #{seg_idx} submitted to global queue: "
                            f"{len(text)} chars | «{text[:60]}»"
                        )

                        if (XTTS_MODEL is not None
                                and hasattr(XTTS_MODEL, "tokenizer")
                                and XTTS_MODEL.tokenizer is not None):
                            text = XTTS_MODEL.tokenizer.preprocess_text(text, "be")

                        raw_out_q = stdlib_queue.Queue()
                        job = TTSJob(
                            text=text,
                            gpt_cond_latent=gpt_cond_latent,
                            speaker_embedding=speaker_embedding,
                            cancel_event=cancel_event,
                            raw_out_q=raw_out_q,
                            session_id=session_id,
                            seg_idx=seg_idx,
                            temperature=getattr(app_config, 'TTS_TEMPERATURE', 0.15),
                            top_k=getattr(app_config, 'TTS_TOP_K', 5),
                            top_p=getattr(app_config, 'TTS_TOP_P', 0.75),
                        )

                        GLOBAL_GPU_QUEUE.put(job)
                        _job_q.put((seg_idx, raw_out_q, t_seg))
                except Exception as e:
                    log.error(f"Error in TTS prefetch thread: {e}", exc_info=True)
                finally:
                    _job_q.put(None)  # sentinel — always unblock _continuous_raw_gen

            threading.Thread(target=_prefetch_thread, daemon=True).start()

            def _continuous_raw_gen():
                """Yield raw audio chunks from pre-submitted GPU jobs."""
                while True:
                    if cancel_event and cancel_event.is_set():
                        log.info("[TTS·TIMING] ⛔ Cancel event set, stopping sentence generator")
                        return

                    try:
                        item = _job_q.get(timeout=0.5)
                    except stdlib_queue.Empty:
                        continue
                    if item is None:
                        break
                    seg_idx, raw_out_q, t_seg = item

                    seg_chunks = 0
                    seg_samples = 0

                    while True:
                        c_np = raw_out_q.get()
                        if c_np is None:
                            break

                        seg_chunks += 1
                        seg_samples += c_np.size
                        if seg_chunks == 1:
                            log.info(
                                f"[TTS·TIMING]   Seg #{seg_idx} 1st raw chunk (from worker): "
                                f"{(time.perf_counter()-t_seg)*1000:.1f} ms | "
                                f"{c_np.size} samples"
                            )
                        yield c_np

                    if cancel_event and cancel_event.is_set():
                        return
                    seg_ms = (time.perf_counter() - t_seg) * 1000
                    seg_audio_ms = seg_samples / sampling_rate * 1000
                    log.info(
                        f"[TTS·TIMING] ◼ Seg #{seg_idx} done: "
                        f"{seg_chunks} raw chunks | {seg_ms:.0f} ms inference | "
                        f"{seg_audio_ms:.0f} ms audio"
                    )

            # ONE _chunker wrapping ALL sentences — no gaps!
            t_inf = time.perf_counter()
            count = 0
            total_samples = 0

            # inference_mode / autocast are no longer needed here, they happen in global worker!
            for audio_chunk in _chunker(
                _continuous_raw_gen(),
                sampling_rate,
                initial_buffer_s,
                subsequent_buffer_s,
            ):
                count += 1
                n = len(audio_chunk)
                total_samples += n
                ms = n / sampling_rate * 1000
                elapsed = (time.perf_counter() - t_inf) * 1000

                if count == 1:
                    log.info(
                        f"[TTS·TIMING] 🎵 Multi 1st buffered chunk: "
                        f"elapsed={elapsed:.1f} ms | "
                        f"total_from_start="
                        f"{(time.perf_counter()-t_pipeline)*1000:.1f} ms | "
                        f"audio={ms:.0f} ms ({n} samples)"
                    )
                elif count <= 3:
                    log.info(
                        f"[TTS·TIMING] Multi chunk #{count}: "
                        f"{ms:.0f} ms audio | elapsed={elapsed:.0f} ms"
                    )

                audio_out_q.put(audio_chunk)

            total_audio = total_samples / sampling_rate * 1000
            total_inf = (time.perf_counter() - t_inf) * 1000
            rtf = total_inf / total_audio if total_audio > 0 else 0
            log.info(
                f"[TTS·TIMING] ✅ Multi done: inference={total_inf:.0f} ms | "
                f"chunks={count} | audio={total_audio:.0f} ms | RTF={rtf:.2f}x"
            )

        except Exception as e:
            log.error(f"Error in multi TTS inference: {e}", exc_info=True)
        finally:
            audio_out_q.put(SENTINEL)

    threading.Thread(target=producer, daemon=True).start()

    # ── Async consumer: yield chunks from audio_out_q ──
    idx = 0
    total_wait = 0.0
    try:
        while True:
            t_wait = time.perf_counter()
            chunk = await loop.run_in_executor(None, audio_out_q.get)
            wait_ms = (time.perf_counter() - t_wait) * 1000
            total_wait += wait_ms

            if chunk is SENTINEL:
                break

            idx += 1
            bytes_data = chunk.tobytes()

            if idx <= 3 or wait_ms > 50:
                log.info(
                    f"[TTS·TIMING] Multi queue→async #{idx}: "
                    f"wait={wait_ms:.1f} ms | {len(bytes_data)} bytes"
                )

            if yield_raw_pcm:
                yield bytes_data
            else:
                yield _add_wav_header(bytes_data, sample_rate=sampling_rate, channels=1)
    finally:
        # Ensure producer thread can exit: set cancel, send sentinel, cleanup forwarder
        if cancel_event:
            cancel_event.set()
        try:
            sync_sentence_q.put_nowait(None)
        except Exception:
            pass
        forwarder_task.cancel()
        try:
            await forwarder_task
        except (asyncio.CancelledError, Exception):
            pass
    log.info(
        f"[TTS·TIMING] Multi pipeline complete: {idx} chunks | "
        f"total_wait={total_wait:.0f} ms | "
        f"pipeline={(time.perf_counter()-t_pipeline)*1000:.0f} ms"
    )


def synthesize_to_file(
    text_input: str,
    output_path: str,
    speaker_audio: Optional[str] = None
) -> str:
    """Нестрымінгавая генерацыя ўсяго тэксту і захаванне яго ў адзіны WAV-файл.

    Доўгія тэксты аўтаматычна разбіваюцца на кавалкі па ≤180 сімвалаў
    (ліміт бібліятэкі XTTS для беларускай мовы), а потым зліваюцца ў адзін файл.
    """
    if XTTS_MODEL is None:
        load_model()
    if not text_input or not text_input.strip():
        raise ValueError("Тэкст пусты")

    gpt_cond_latent, speaker_embedding = _latents_for(
        speaker_audio or default_voice_file,
        to_device=device,
    )

    # Ліміт для беларускай мовы ў бібліятэцы XTTS — 182 сімвалы на сказ.
    # Мы разбіваем тэкст самі, каб пазбегнуць AssertionError (400 токенаў) унутры inference().
    BE_CHAR_LIMIT = 180
    chunks = split_sentence(text_input.strip(), "be", BE_CHAR_LIMIT)
    log.info(
        f"Сінтэз у файл: {len(text_input)} сімвалаў → {len(chunks)} кавалак(аў)"
    )

    all_audio: list = []

    for i, chunk in enumerate(chunks):
        chunk = chunk.strip()
        if not chunk:
            continue
        log.info(f"  Кавалак {i+1}/{len(chunks)}: {len(chunk)} сімв.")

        with torch.inference_mode(), torch.autocast(
            device_type="cuda",
            dtype=torch.float32,
            enabled=str(device).startswith("cuda"),
        ):
            with _inference_lock:
                out = XTTS_MODEL.inference(
                    text=chunk,
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
        all_audio.append(audio_np)

    if not all_audio:
        raise RuntimeError("Сінтэз не даў аўдыё-вынікаў")

    combined = np.concatenate(all_audio)
    wav_bytes = _add_wav_header(combined.tobytes(), sample_rate=sampling_rate, channels=1)
    with open(output_path, "wb") as f:
        f.write(wav_bytes)
    log.info(
        f"Файл захаваны: {output_path} ({len(combined)/sampling_rate:.1f}s аўдыё)"
    )
    return output_path

