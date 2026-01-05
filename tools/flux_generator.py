# flux_generate_tool.py — FunctionTool для генерацыі малюнкаў праз FLUX.1 (fal.ai)
"""Версія 4 — робім, як у прыкладзе з TTS:

• Асноўная функцыя **async** і адразу вяртае `types.Part`, у якім толькі
  метаданыя артэфакта (inline_data пусты).
• Малюнак захоўваем праз `await tool_context.save_artifact`, што гарантавана
  працуе ў ADK‑Runner (аналёгічна text‑to‑speech прыкладу).
• Калі нешта ідзе не так — вяртаем Part з тэкстам памылкі, каб агент
  мог карэктна адказаць карыстальніку.
"""

from __future__ import annotations

import base64
import os
import re
import traceback
from typing import Any, Dict, Iterable, List, Optional, Union

import fal_client  # pip install fal-client
import requests
from google.adk.tools import FunctionTool
from google.adk.tools.tool_context import ToolContext
from google.genai import types

# ---------------------------------------------------------------------------
# 1. Utilities
# ---------------------------------------------------------------------------
_AR_MAP = {
    "1:1": "square_hd",
    "square": "square_hd",
    "4:3": "landscape_4_3",
    "3:4": "portrait_4_3",
    "16:9": "landscape_16_9",
    "9:16": "portrait_16_9",
}


def _aspect_ratio_to_flux(ar: str) -> Union[str, Dict[str, int]]:
    ar = ar.strip().lower()
    if ar in _AR_MAP:
        return _AR_MAP[ar]
    try:
        w, h = map(float, ar.split(":"))
        base = 1024 if w >= h else 768
        k = base / max(w, h)
        return {"width": int(w * k), "height": int(h * k)}
    except Exception:
        return "square_hd"


def _mime_to_format(mime: str) -> str:
    return "jpeg" if mime.lower().endswith(("jpeg", "jpg")) else "png"


def _is_data_uri(s: str) -> bool:
    return s.lstrip().startswith("data:")


def _data_uri_to_b64(uri: str) -> str:
    m = re.match(r"data:[^;]+;base64,(.*)", uri, re.IGNORECASE)
    return m.group(1) if m else ""

# ---------------------------------------------------------------------------
# 2. Core async function (returns Part)
# ---------------------------------------------------------------------------

async def generate_image(
    prompt: str,
    number_of_images: int = 1,
    aspect_ratio: str = "1:1",
    person_generation: str = "ALLOW_ADULT",
    output_mime_type: str = "image/jpeg",
    tool_context: Optional[ToolContext] = None,
):
    """Генеруе 1 малюнак праз FLUX, захоўвае як артэфакт і вяртае Part.

    Калі нешта ламаецца, вяртаем Part з тэкстам памылкі, каб агент
    мог паказаць яе карыстальніку.
    """

    try:
        if not os.getenv("FAL_KEY"):
            raise RuntimeError("FAL_KEY env var not set")

        args = {
            "prompt": prompt,
            "num_images": max(1, min(number_of_images, 4)),
            "image_size": _aspect_ratio_to_flux(aspect_ratio),
            "output_format": _mime_to_format(output_mime_type),
            "enable_safety_checker": person_generation.upper() != "ALLOW_ADULT",
            "sync_mode": True,
        }
        # rundiffusion-fal/juggernaut-flux/lightning fal-ai/flux/dev
        result = fal_client.run("rundiffusion-fal/juggernaut-flux/lightning", arguments=args)

        # ------------------ extract first image bytes ------------------
        def _extract_images(obj: Any) -> Optional[Iterable[Any]]:
            if isinstance(obj, dict):
                for key in ("images", "image", "output", "data"):
                    if key in obj and obj[key]:
                        val = obj[key]
                        if key in ("output", "data") and isinstance(val, dict):
                            return val.get("images") or val.get("image")
                        return val
            return None

        images_meta = _extract_images(result)
        if not images_meta:
            raise RuntimeError("No images field in FLUX response")

        # возьмем толькі першы малюнак
        item = list(images_meta)[0]
        img_bytes: Optional[bytes] = None
        files_map: Dict[str, Any] = result.get("files", {}) if isinstance(result, dict) else {}

        def _download(url: str) -> bytes:
            resp = requests.get(url, timeout=60)
            resp.raise_for_status()
            return resp.content

        if isinstance(item, str):
            if _is_data_uri(item):
                img_bytes = base64.b64decode(_data_uri_to_b64(item))
            elif item.startswith("http"):
                img_bytes = _download(item)
            else:
                url = files_map.get(item, {}).get("url")
                if not url:
                    raise RuntimeError("Image URL not found in files map")
                # падтрымка data-uri ў полі URL
                if _is_data_uri(url):
                    img_bytes = base64.b64decode(_data_uri_to_b64(url))
                else:
                    # падтрымка data-uri ў выпадку URL у dict
                    if _is_data_uri(url):
                        img_bytes = base64.b64decode(_data_uri_to_b64(url))
                    else:
                        img_bytes = _download(url)
        else:  # dict
            if item.get("base64"):
                img_bytes = base64.b64decode(item["base64"])
            elif item.get("file_data"):
                img_bytes = base64.b64decode(item["file_data"])
            else:
                url = (
                    item.get("url")
                    or item.get("image_url")
                    or item.get("uri")
                    or files_map.get(item.get("file_id", ""), {}).get("url")
                )
                if not url:
                    raise RuntimeError("URL not found for image dict")
                # падтрымка data-uri ў выпадку URL у dict
                if _is_data_uri(url):
                    img_bytes = base64.b64decode(_data_uri_to_b64(url))
                else:
                    img_bytes = _download(url)

        if not img_bytes:
            raise RuntimeError("Failed to obtain image bytes")

        # ------------------ save artifact ------------------
        #filename = "flux_image.jpeg" if output_mime_type.endswith("jpeg") else "flux_image.png"
        # Ачышчаем prompt, каб назва файла была бяспечнай
        safe_prompt = re.sub(r"[^a-zA-Z0-9_-]", "_", prompt.strip().lower())[:20]
        ext = "jpeg" if output_mime_type.endswith("jpeg") else "png"
        filename = f"flux_{safe_prompt}.{ext}"

        img_part = types.Part.from_bytes(data=img_bytes, mime_type=output_mime_type)
        artifact_part = await tool_context.save_artifact(filename=filename, artifact=img_part)

        return artifact_part  # вяртаем Part без inline_data

    except Exception as exc:  # pylint: disable=broad-except
        traceback.print_exc()
        return types.Part(text=f"Памылка пры генерацыі малюнка: {exc!r}")


# ---------------------------------------------------------------------------
# 3. FunctionTool wrapper
# ---------------------------------------------------------------------------

generate_image_tool = FunctionTool(generate_image)

__all__ = ["generate_image_tool"]
