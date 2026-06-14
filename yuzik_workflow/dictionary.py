from __future__ import annotations

from typing import Any

from google.genai import types

from tools.dictionary_tool import lookup_dictionary
from yuzik_workflow.policy import PENDING_TEXT_ACTION_KEY


DICTIONARY_WORD_REQUEST = "Якое слова шукаць?"


def _state_str(state: dict[str, Any], key: str) -> str | None:
    value = state.get(key)
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def _state_str_list(state: dict[str, Any], key: str) -> list[str]:
    value = state.get(key)
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


async def dictionary_lookup_node(ctx, node_input):
    _ = node_input
    state = ctx.state
    sources = _state_str_list(state, "temp:dictionary_sources")
    slounik_dicts = _state_str_list(state, "temp:slounik_dicts")
    word = _state_str(state, "temp:dictionary_word")

    if state.get("temp:dictionary_needs_word") or not word:
        state[PENDING_TEXT_ACTION_KEY] = {
            "kind": "dictionary",
            "sources": sources,
            "slounik_dicts": slounik_dicts,
        }
        return types.Content(
            role="model",
            parts=[types.Part(text=DICTIONARY_WORD_REQUEST)],
        )

    state[PENDING_TEXT_ACTION_KEY] = None
    part = await lookup_dictionary(
        word,
        sources=sources or None,
        slounik_dicts=slounik_dicts or None,
    )
    if isinstance(part, types.Part):
        return types.Content(role="model", parts=[part])
    return part
