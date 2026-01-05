# tools/text_to_speech_tool.py
"""
Інструмент для сінтэзу маўлення (Belarusian TTS).
Выкарыстоўвае Gradio-дэма «archivartaunik/Bextts» і вяртае WAV-файл
у выглядзе артэфакта ADK, каб асноўны Runner мог бяспечна пераслаць
файл карыстальніку без раздзьмухвання LLM-prompt.
"""

from __future__ import annotations

import os
import traceback
from typing import Optional

import logging
from google.genai import types
from google.adk.tools import FunctionTool, ToolContext
from gradio_client import Client, handle_file

log = logging.getLogger(__name__)

# ────────────────────────── ініцыялізацыя Gradio ─────────────────────────
HUGGINGFACE_API_TOKEN = os.getenv("HF_TOKEN")
if HUGGINGFACE_API_TOKEN:
    gradio_client = Client("archivartaunik/Bextts", hf_token=HUGGINGFACE_API_TOKEN)
#    gradio_client = Client("archivartaunik/BeTTSNaciski", hf_token=HUGGINGFACE_API_TOKEN)
else:
    log.warning("HUGGINGFACE_TOKEN не зададзены — выкарыстоўваю ананімны доступ.")
    gradio_client = Client("archivartaunik/BeTTSNaciski")


# ────────────────────────── асноўная функцыя ─────────────────────────────
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
        # --- выклік Gradio TTS ------------------------------------------------
        if speaker_audio_path:
            if not os.path.exists(speaker_audio_path):
                raise FileNotFoundError(f"File for cloning not found: {speaker_audio_path}")
            result_path = gradio_client.predict(
                belarusian_story=text,
                speaker_audio_file=handle_file(speaker_audio_path),
                api_name="/predict",
            )
        else:
            result_path = gradio_client.predict(
                belarusian_story=text,
                speaker_audio_file=None,
                api_name="/predict",
            )

        if not result_path or not os.path.exists(result_path):
            raise ConnectionError("TTS API did not return a WAV file.")

        # --- чытаем WAV --------------------------------------------------------
        with open(result_path, "rb") as f:
            audio_bytes = f.read()

        # --- ствараем Part і захоўваем як артэфакт ----------------------------
        audio_part = types.Part.from_bytes(data=audio_bytes, mime_type="audio/wav")
        artifact_part = await tool_context.save_artifact(
            filename="tts_output.wav",
            artifact=audio_part,
        )

        return artifact_part  # ⬅️ вяртаем Part з artifact (без inline_data)

    except Exception as exc:  # pylint: disable=broad-except
        traceback.print_exc()
        # вяртаем тэкставую памылку, каб агент мог апрацаваць
        return types.Part(text=f"Памылка пры сінтэзе маўлення: {exc!r}")

    finally:
        # --- ачышчаем часовы файл --------------------------------------------
        if result_path and os.path.exists(result_path):
            try:
                os.remove(result_path)
            except OSError as exc:
                log.error(f"Не атрымалася выдаліць {result_path}: {exc}")


# ────────────────────────── рэгістрацыя ў ADK ────────────────────────────
synthesize_speech_tool = FunctionTool(func=synthesize_speech)
