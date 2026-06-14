from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Literal, Mapping


RouteName = Literal["default", "image", "translation", "dictionary", "direct", "cancel"]
ActionName = Literal["tts"]

VALID_ROUTES = {"default", "image", "translation", "dictionary", "direct", "cancel"}
VALID_ACTIONS = {"tts"}
DEFAULT_INTENT_CONFIDENCE_THRESHOLD = 0.6


@dataclass
class TurnIntent:
    route: RouteName = "default"
    actions: list[ActionName] = field(default_factory=list)
    target_language: str | None = None
    dictionary_word: str | None = None
    dictionary_sources: list[str] = field(default_factory=list)
    slounik_dicts: list[str] = field(default_factory=list)
    needs_dictionary_word: bool = False
    timezone: str | None = None
    needs_previous_context: bool = False
    confidence: float = 0.0


def _get_field(value: Any, name: str, default: Any = None) -> Any:
    if isinstance(value, Mapping):
        return value.get(name, default)
    return getattr(value, name, default)


def _json_text_from_content(value: Any) -> str | None:
    parts = getattr(value, "parts", None)
    if not parts:
        return None
    text = "\n".join(
        part.text for part in parts if isinstance(getattr(part, "text", None), str)
    ).strip()
    return text or None


def _parse_json_object(value: Any) -> Any:
    if isinstance(value, str):
        text = value.strip()
    else:
        text = _json_text_from_content(value)
    if not text:
        return value
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return value
    return parsed if isinstance(parsed, Mapping) else value


def _coerce_confidence(value: Any) -> float:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return 0.0
    return min(1.0, max(0.0, confidence))


def _coerce_str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def coerce_turn_intent(value: Any) -> TurnIntent:
    if isinstance(value, TurnIntent):
        return TurnIntent(
            route=value.route,
            actions=list(value.actions),
            target_language=value.target_language,
            dictionary_word=value.dictionary_word,
            dictionary_sources=list(value.dictionary_sources),
            slounik_dicts=list(value.slounik_dicts),
            needs_dictionary_word=bool(value.needs_dictionary_word),
            timezone=value.timezone,
            needs_previous_context=bool(value.needs_previous_context),
            confidence=_coerce_confidence(value.confidence),
        )

    value = _parse_json_object(value)

    route = _get_field(value, "route", "default")
    if route not in VALID_ROUTES:
        route = "default"

    raw_actions = _get_field(value, "actions", [])
    if not isinstance(raw_actions, list):
        raw_actions = []
    actions = [action for action in raw_actions if action in VALID_ACTIONS]

    target_language = _get_field(value, "target_language")
    if target_language is not None:
        target_language = str(target_language).strip() or None

    dictionary_word = _get_field(value, "dictionary_word")
    if dictionary_word is not None:
        dictionary_word = str(dictionary_word).strip() or None

    timezone = _get_field(value, "timezone")
    if timezone is not None:
        timezone = str(timezone).strip() or None

    return TurnIntent(
        route=route,
        actions=actions,
        target_language=target_language,
        dictionary_word=dictionary_word,
        dictionary_sources=_coerce_str_list(_get_field(value, "dictionary_sources", [])),
        slounik_dicts=_coerce_str_list(_get_field(value, "slounik_dicts", [])),
        needs_dictionary_word=bool(_get_field(value, "needs_dictionary_word", False)),
        timezone=timezone,
        needs_previous_context=bool(_get_field(value, "needs_previous_context", False)),
        confidence=_coerce_confidence(_get_field(value, "confidence", 0.0)),
    )
