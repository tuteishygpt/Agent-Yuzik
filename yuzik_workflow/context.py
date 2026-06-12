from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from google.genai import types


MAX_INLINE_PREVIOUS_TEXT_CHARS = 6000


@dataclass(frozen=True)
class TurnContext:
    current_content: types.Content
    current_text: str | None
    previous_text: str | None
    previous_summary: str | None
    previous_artifact_id: str | None
    language: str


def text_from_content(content: types.Content | None) -> str | None:
    if content is None:
        return None
    text = "\n".join(
        part.text for part in (content.parts or []) if getattr(part, "text", None)
    ).strip()
    return text or None


def detect_language(text: str | None) -> str:
    if not text:
        return "be"
    lowered = text.lower()
    if any("a" <= ch <= "z" for ch in lowered):
        return "en"
    if any(token in lowered for token in ("привет", "как ", "дела", "сегодня")):
        return "ru"
    if any(ch in lowered for ch in "іў"):
        return "be"
    if any(ch in lowered for ch in "ыэъ"):
        return "ru"
    return "be"


def _state_str(state: dict[str, Any], key: str) -> str | None:
    value = state.get(key)
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def previous_text_from_state(state: dict[str, Any]) -> str | None:
    text = _state_str(state, "user:last_assistant_text")
    if text is None or len(text) > MAX_INLINE_PREVIOUS_TEXT_CHARS:
        return None
    return text


def previous_summary_from_state(state: dict[str, Any]) -> str | None:
    return _state_str(state, "user:last_assistant_summary")


def previous_artifact_id_from_state(state: dict[str, Any]) -> str | None:
    return _state_str(state, "user:last_assistant_artifact_id")


async def turn_context_node(ctx, node_input):
    current_content = (
        node_input
        if isinstance(node_input, types.Content)
        else types.Content(role="user", parts=[types.Part(text=str(node_input))])
    )
    current_text = text_from_content(current_content)
    state = ctx.state

    return TurnContext(
        current_content=current_content,
        current_text=current_text,
        previous_text=previous_text_from_state(state),
        previous_summary=previous_summary_from_state(state),
        previous_artifact_id=previous_artifact_id_from_state(state),
        language=detect_language(current_text),
    )
