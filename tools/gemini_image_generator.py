"""ADK image generation tool backed by Gemini image models."""

from __future__ import annotations

import base64
import json
import re
import traceback
from typing import Iterable, Optional

import aiohttp
import config
from google import genai
from google.adk.tools import FunctionTool
from google.adk.tools.tool_context import ToolContext
from google.genai import types


DEFAULT_IMAGE_GENERATION_MODEL = "gemini-2.5-flash-image"


def _get_genai_client():
    api_key = config.GEMINI_API_KEY or config.GOOGLE_API_KEY
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY or GOOGLE_API_KEY env var not set")
    return genai.Client(api_key=api_key)


def _iter_response_parts(response) -> Iterable[types.Part]:
    parts = getattr(response, "parts", None)
    if parts:
        return parts

    candidates = getattr(response, "candidates", None) or []
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        candidate_parts = getattr(content, "parts", None) or []
        if candidate_parts:
            return candidate_parts

    return []


def _mime_to_extension(mime_type: str) -> str:
    lowered = mime_type.lower()
    if lowered.endswith(("jpeg", "jpg")):
        return "jpeg"
    if lowered.endswith("webp"):
        return "webp"
    return "png"


def _safe_filename(prompt: str, mime_type: str) -> str:
    safe_prompt = re.sub(r"[^a-zA-Z0-9_-]", "_", prompt.strip().lower())[:20] or "image"
    return f"gemini_{safe_prompt}.{_mime_to_extension(mime_type)}"


def _build_gemini_image_config_kwargs(
    *,
    aspect_ratio: str,
) -> dict[str, str]:
    # Gemini Developer API currently accepts only a subset of ImageConfig fields.
    return {
        "aspect_ratio": aspect_ratio,
    }


async def _generate_gemini_parts(
    *,
    model: str,
    prompt: str,
    aspect_ratio: str,
    person_generation: str,
    output_mime_type: str,
) -> list[types.Part]:
    if hasattr(types, "ImageConfig"):
        client = _get_genai_client()
        response = await client.aio.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE"],
                image_config=types.ImageConfig(**_build_gemini_image_config_kwargs(
                    aspect_ratio=aspect_ratio,
                )),
            ),
        )
        return list(_iter_response_parts(response))

    return await _generate_gemini_parts_via_rest(
        model=model,
        prompt=prompt,
        aspect_ratio=aspect_ratio,
        person_generation=person_generation,
        output_mime_type=output_mime_type,
    )


async def _generate_gemini_parts_via_rest(
    *,
    model: str,
    prompt: str,
    aspect_ratio: str,
    person_generation: str,
    output_mime_type: str,
) -> list[types.Part]:
    api_key = config.GEMINI_API_KEY or config.GOOGLE_API_KEY
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY or GOOGLE_API_KEY env var not set")

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt}],
            }
        ],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {
                "aspectRatio": aspect_ratio,
            },
        },
    }

    timeout = aiohttp.ClientTimeout(total=120)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(
            url,
            headers={
                "x-goog-api-key": api_key,
                "Content-Type": "application/json",
            },
            json=payload,
        ) as response:
            response_text = await response.text()
            if response.status >= 400:
                raise RuntimeError(f"Gemini API error {response.status}: {response_text}")
            data = json.loads(response_text)

    parts: list[types.Part] = []
    candidates = data.get("candidates") or []
    for candidate in candidates:
        content = candidate.get("content") or {}
        for part_data in content.get("parts") or []:
            if part_data.get("text"):
                parts.append(types.Part(text=part_data["text"]))
                continue
            inline_data = part_data.get("inlineData") or part_data.get("inline_data")
            if inline_data and inline_data.get("data"):
                mime_type = (
                    inline_data.get("mimeType")
                    or inline_data.get("mime_type")
                    or output_mime_type
                )
                parts.append(
                    types.Part.from_bytes(
                        data=base64.b64decode(inline_data["data"]),
                        mime_type=mime_type,
                    )
                )
    return parts


async def generate_image(
    prompt: str,
    number_of_images: int = 1,
    aspect_ratio: str = "1:1",
    person_generation: str = "ALLOW_ADULT",
    output_mime_type: str = "image/jpeg",
    tool_context: Optional[ToolContext] = None,
):
    try:
        if number_of_images != 1:
            return types.Part(
                text=(
                    "Памылка пры генерацыі малюнка: "
                    "number_of_images падтрымліваецца толькі са значэннем 1 для Gemini."
                )
            )

        if tool_context is None:
            return types.Part(text="Памылка пры генерацыі малюнка: tool_context is required.")

        model_name = config.IMAGE_GENERATION_MODEL or DEFAULT_IMAGE_GENERATION_MODEL
        parts = await _generate_gemini_parts(
            model=model_name,
            prompt=prompt,
            aspect_ratio=aspect_ratio,
            person_generation=person_generation,
            output_mime_type=output_mime_type,
        )

        for part in parts:
            inline_data = getattr(part, "inline_data", None)
            if inline_data and getattr(inline_data, "data", None):
                mime_type = getattr(inline_data, "mime_type", None) or output_mime_type
                image_part = types.Part.from_bytes(data=inline_data.data, mime_type=mime_type)
                return await tool_context.save_artifact(
                    filename=_safe_filename(prompt, mime_type),
                    artifact=image_part,
                )

        return types.Part(text="Памылка пры генерацыі малюнка: No image returned by Gemini.")
    except Exception as exc:  # pylint: disable=broad-except
        traceback.print_exc()
        return types.Part(text=f"Памылка пры генерацыі малюнка: {exc!r}")


generate_image_tool = FunctionTool(generate_image)

__all__ = ["generate_image_tool"]
