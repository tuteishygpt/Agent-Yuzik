# api/local_asr.py
"""
Local ASR (Automatic Speech Recognition) module using NeMo Hybrid RNNT-CTC model.

Uses nvidia/stt_be_fastconformer_hybrid_large_pc with CTC decoding for
on-device speech-to-text transcription. When enabled via config.LOCAL_ASR,
audio is first transcribed locally, then the text is sent to the LLM.
"""

from __future__ import annotations

import logging
import sys
import time
from unittest.mock import MagicMock

import numpy as np
import torch

log = logging.getLogger("app.voice.asr")

# ── Module-level state ────────────────────────────────────────────────
_asr_model = None
_model_loading = False

# TranscribeConfig exists in most recent NeMo; keep a safe fallback
TranscribeConfig = None


def _load_transcribe_config():
    """Try to import TranscribeConfig from NeMo (optional)."""
    global TranscribeConfig
    try:
        from nemo.collections.asr.parts.mixins.transcription import TranscribeConfig as _TC
        TranscribeConfig = _TC
        log.info("[LOCAL·ASR] TranscribeConfig loaded from NeMo")
    except Exception:
        TranscribeConfig = None
        log.info("[LOCAL·ASR] TranscribeConfig not available, using fallback mode")


def _ensure_nemo_imports():
    """Import nemo_asr with nv_one_logger mock workaround if needed."""
    try:
        import nemo.collections.asr as nemo_asr
        from nemo.utils import logging as nemo_logging
        return nemo_asr, nemo_logging
    except ModuleNotFoundError as e:
        if "nv_one_logger" in str(e):
            mock_logger = MagicMock()
            for mod_name in [
                "nv_one_logger",
                "nv_one_logger.api",
                "nv_one_logger.api.config",
                "nv_one_logger.training_telemetry",
                "nv_one_logger.training_telemetry.api",
                "nv_one_logger.training_telemetry.api.callbacks",
                "nv_one_logger.training_telemetry.api.config",
            ]:
                sys.modules[mod_name] = mock_logger
            log.info("[LOCAL·ASR] Mocked nv_one_logger for NeMo compatibility")
            import nemo.collections.asr as nemo_asr
            from nemo.utils import logging as nemo_logging
            return nemo_asr, nemo_logging
        raise


def load_asr_model(model_name: str | None = None) -> None:
    """Load the NeMo ASR model into GPU/CPU memory.

    Call this once at startup (e.g. from ``app.py`` lifespan) so the
    first voice request does not pay the model-load cost.

    Args:
        model_name: NeMo model identifier, e.g.
            ``"nvidia/stt_be_fastconformer_hybrid_large_pc"``.
            Defaults to ``config.LOCAL_ASR_MODEL``.
    """
    global _asr_model, _model_loading

    if _asr_model is not None:
        log.info("[LOCAL·ASR] ASR model already loaded, skipping")
        return

    if _model_loading:
        log.warning("[LOCAL·ASR] ASR model is currently loading, skipping duplicate call")
        return

    _model_loading = True
    try:
        import config as cfg

        nemo_asr, nemo_logging = _ensure_nemo_imports()

        # Reduce NeMo / Lhotse logging noise
        nemo_logging.set_verbosity(logging.ERROR)
        logging.getLogger("lhotse").setLevel(logging.ERROR)

        name = model_name or cfg.LOCAL_ASR_MODEL
        log.info(f"[LOCAL·ASR] Loading ASR model: {name} …")
        t0 = time.time()

        _asr_model = nemo_asr.models.EncDecHybridRNNTCTCBPEModel.from_pretrained(
            model_name=name
        )

        device = "cuda" if torch.cuda.is_available() else "cpu"
        _asr_model = _asr_model.to(device).eval()

        # Switch to CTC decoding (do this ONCE, not per request)
        _asr_model.change_decoding_strategy(decoder_type="ctc")

        elapsed = time.time() - t0
        log.info(
            f"[LOCAL·ASR] ✅ ASR model loaded in {elapsed:.1f}s | "
            f"device={device} | model={name} | decoding=CTC"
        )

        if device == "cuda":
            log.info(f"[LOCAL·ASR] GPU: {torch.cuda.get_device_name(0)}")

        _load_transcribe_config()

    except Exception:
        log.exception("[LOCAL·ASR] ❌ Failed to load ASR model")
        _asr_model = None
    finally:
        _model_loading = False


def is_ready() -> bool:
    """Return True if the ASR model is loaded and ready for inference."""
    return _asr_model is not None


# ── Private helpers ───────────────────────────────────────────────────

def _sync_cuda():
    if torch.cuda.is_available():
        torch.cuda.synchronize()


def _resample_to_16k(y: np.ndarray, sr: int):
    """Minimal resampling without librosa. Uses scipy if needed."""
    if sr == 16000:
        return y.astype(np.float32), 16000
    from scipy.signal import resample_poly
    gcd = np.gcd(16000, sr)
    up = 16000 // gcd
    down = sr // gcd
    y16 = resample_poly(y, up, down).astype(np.float32)
    return y16, 16000


# ── Public transcription API ─────────────────────────────────────────

@torch.inference_mode()
def transcribe_paths(paths: list[str], batch_size: int = 1) -> str:
    """Transcribe audio files by path.

    Args:
        paths: List of audio file paths (best: WAV 16 kHz mono).
        batch_size: Inference batch size.

    Returns:
        Transcription string of the first item.
    """
    if _asr_model is None:
        raise RuntimeError("ASR model is not loaded. Call load_asr_model() first.")

    if TranscribeConfig is not None:
        cfg = TranscribeConfig(
            batch_size=batch_size,
            num_workers=0,
            verbose=False,
            return_hypotheses=False,
        )
        _sync_cuda()
        out = _asr_model.transcribe(paths, override_config=cfg)
        _sync_cuda()
    else:
        _sync_cuda()
        out = _asr_model.transcribe(paths, batch_size=batch_size, verbose=False)
        _sync_cuda()

    first = out[0]
    return first.text if hasattr(first, "text") else str(first)


@torch.inference_mode()
def transcribe_audio(y: np.ndarray, sr: int) -> str:
    """Transcribe a numpy audio array.

    Args:
        y: Numpy array (mono or stereo).
        sr: Sample rate.

    Returns:
        Transcription string.
    """
    if _asr_model is None:
        raise RuntimeError("ASR model is not loaded. Call load_asr_model() first.")

    if y.ndim == 2:
        y = np.mean(y, axis=0)
    y = y.astype(np.float32, copy=False)
    y, sr = _resample_to_16k(y, sr)

    # NeMo transcribe() expects a list of 1D arrays, NOT a pre-batched 2D array
    audio_list = [y]

    if TranscribeConfig is not None:
        cfg = TranscribeConfig(
            batch_size=1,
            num_workers=0,
            verbose=False,
            return_hypotheses=False,
        )
        _sync_cuda()
        out = _asr_model.transcribe(audio_list, override_config=cfg)
        _sync_cuda()
    else:
        _sync_cuda()
        out = _asr_model.transcribe(audio_list, batch_size=1, verbose=False)
        _sync_cuda()

    first = out[0]
    return first.text if hasattr(first, "text") else str(first)


def transcribe_wav_bytes(wav_data: bytes) -> str:
    """Transcribe raw WAV bytes (the main entry point for voice pipeline).

    Reads WAV from memory via soundfile, resamples to 16 kHz if needed,
    and runs NeMo CTC inference.

    Args:
        wav_data: Complete WAV file bytes (RIFF header + PCM data).

    Returns:
        Transcription text.
    """
    import io
    import soundfile as sf

    t0 = time.time()

    data, sr = sf.read(io.BytesIO(wav_data), dtype="float32")
    read_ms = (time.time() - t0) * 1000

    if data.ndim == 2:
        data = np.mean(data, axis=0)

    log.info(
        f"[LOCAL·ASR] WAV decoded: {len(data)} samples @ {sr} Hz | "
        f"duration={len(data)/sr:.2f}s | read={read_ms:.0f}ms"
    )

    t1 = time.time()
    text = transcribe_audio(data, sr)
    infer_ms = (time.time() - t1) * 1000
    total_ms = (time.time() - t0) * 1000

    log.info(
        f"[LOCAL·ASR] ✅ Transcription done in {total_ms:.0f}ms "
        f"(read={read_ms:.0f}ms, infer={infer_ms:.0f}ms) | "
        f"text=«{text[:120]}»"
    )
    return text
