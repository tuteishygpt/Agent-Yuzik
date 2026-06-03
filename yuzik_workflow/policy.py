from __future__ import annotations

from typing import Any

from google.adk.events import Event
from google.genai import types

from router_agent.agent import (
    CREATION_CANCEL_PATTERN,
    IMAGE_REQUESTED_PATTERN,
    TIME_RELATED_PATTERN,
    TTS_REQUESTED_PATTERN,
)
from services.gemini_file_policy import validate_gemini_chat_file


def text_from_content(content: types.Content | None) -> str | None:
    if content is None:
        return None
    text = "\n".join(part.text for part in (content.parts or []) if part.text).strip()
    return text or None


def detect_language(text: str | None) -> str:
    if not text:
        return "be"
    lowered = text.lower()
    if any("a" <= ch <= "z" for ch in lowered):
        return "en"
    if any(token in lowered for token in ("привет", "как ", "дела", "сегодня")):
        return "ru"
    if any(ch in lowered for ch in "ііў"):
        return "be"
    if any(ch in lowered for ch in "ыэъ"):
        return "ru"
    return "be"


def evaluate_input_policy(text: str | None) -> dict[str, Any]:
    text = text or ""
    cancelled = bool(CREATION_CANCEL_PATTERN.search(text))
    tts_requested = bool(TTS_REQUESTED_PATTERN.search(text)) and not cancelled
    image_requested = bool(IMAGE_REQUESTED_PATTERN.search(text)) and not cancelled
    minsk_time_enabled = bool(TIME_RELATED_PATTERN.search(text))
    return {
        "language": detect_language(text),
        "timezone": "Europe/Minsk" if minsk_time_enabled else None,
        "minsk_time_enabled": minsk_time_enabled,
        "tts_requested": tts_requested,
        "image_requested": image_requested,
        "creation_cancelled": cancelled,
    }


def evaluate_file_policy(content: types.Content | None) -> dict[str, Any]:
    if content is None:
        return {"file_ok": True, "file_error": None, "file_diagnostics": {}}

    for part in content.parts or []:
        inline_data = getattr(part, "inline_data", None)
        data = getattr(inline_data, "data", None)
        mime_type = getattr(inline_data, "mime_type", None)
        if not data or not mime_type:
            continue
        result = validate_gemini_chat_file(mime_type=mime_type, size_bytes=len(data))
        if not result.supported:
            return {
                "file_ok": False,
                "file_error": result.message,
                "file_diagnostics": result.diagnostics,
            }

    return {"file_ok": True, "file_error": None, "file_diagnostics": {}}


async def input_policy_node(ctx, node_input):
    text = text_from_content(node_input) if isinstance(node_input, types.Content) else None
    policy = evaluate_input_policy(text)
    file_policy = evaluate_file_policy(node_input if isinstance(node_input, types.Content) else None)

    if text:
        ctx.state["temp:yuzik_text"] = text
    for key, value in {**policy, **file_policy}.items():
        ctx.state[f"temp:{key}"] = value

    if not file_policy["file_ok"]:
        ctx.route = "file_error"
        ctx.state["temp:primary_route"] = "fallback"
        ctx.state["temp:primary_text"] = file_policy["file_error"]
        return Event(
            content=types.Content(
                role="model",
                parts=[types.Part(text=file_policy["file_error"])],
            )
        )
    if policy["creation_cancelled"]:
        ctx.route = "cancel"
    elif policy["image_requested"]:
        ctx.route = "image"
    return node_input
