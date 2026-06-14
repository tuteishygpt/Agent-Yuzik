from __future__ import annotations

from typing import Any

from google.adk.events import Event
from google.genai import types

from yuzik_workflow.context import detect_language, text_from_content
from yuzik_workflow.file_policy import file_policy_node
from yuzik_workflow.intent import (
    DEFAULT_INTENT_CONFIDENCE_THRESHOLD,
    TurnIntent,
    coerce_turn_intent,
)


PENDING_TEXT_ACTION_KEY = "user:pending_text_action"
TTS_REQUESTED_FOR_TURN_KEY = "user:tts_requested_for_turn"

TARGET_LANGUAGE_LABELS = {
    "en": "ангельскую",
}

EXPLICIT_TTS_MARKERS = (
    "агуч",
    "аўды",
    "ауды",
    "голас",
    "ўголас",
    "уголас",
    "audio",
    "voice",
    "aloud",
    "tts",
)

FRESH_TASK_MARKERS = (
    "наві",
    "знайд",
    "пашук",
    "пошук",
    "шукай",
    "search",
    "news",
)

NEWS_TASK_MARKERS = (
    "наві",
    "news",
)

PREVIOUS_CONTEXT_MARKERS = (
    "яго",
    "яе",
    "гэта",
    "гэты",
    "гэтую",
    "гэтым",
    "папярэд",
    "апошн",
    "previous",
    "last",
    "above",
)

PREVIOUS_CONTEXT_WORDS = (
    "this",
    "that",
    "it",
)


def build_pending_translation(target_language: str) -> dict[str, str]:
    return {"kind": "translate", "target_language": target_language}


def pending_translation_target(state: dict[str, Any]) -> str | None:
    pending = state.get(PENDING_TEXT_ACTION_KEY)
    if not isinstance(pending, dict):
        return None
    if pending.get("kind") != "translate":
        return None
    target_language = pending.get("target_language")
    return target_language if isinstance(target_language, str) else None


def pending_dictionary_action(state: dict[str, Any]) -> dict[str, Any] | None:
    pending = state.get(PENDING_TEXT_ACTION_KEY)
    if not isinstance(pending, dict):
        return None
    if pending.get("kind") != "dictionary":
        return None
    return pending


def translation_text_request(target_language: str) -> str:
    target_label = TARGET_LANGUAGE_LABELS.get(target_language, target_language)
    return (
        "Калі ласка, напішы тэкст, які трэба перакласці "
        f"на {target_label} мову."
    )


def _current_content_from_state(state: dict[str, Any]) -> types.Content:
    content = state.get("temp:turn_current_content")
    if isinstance(content, types.Content):
        return content
    text = state.get("temp:turn_current_text")
    return types.Content(role="user", parts=[types.Part(text=str(text or ""))])


def _effective_intent(intent: TurnIntent) -> TurnIntent:
    if intent.confidence >= DEFAULT_INTENT_CONFIDENCE_THRESHOLD:
        return intent
    return TurnIntent(confidence=intent.confidence)


def _has_explicit_tts_request(text: str | None) -> bool:
    if not text:
        return False
    lowered = text.casefold()
    return any(marker in lowered for marker in EXPLICIT_TTS_MARKERS)


def _has_previous_context_reference(text: str | None) -> bool:
    if not text:
        return False
    lowered = text.casefold()
    if any(marker in lowered for marker in PREVIOUS_CONTEXT_MARKERS):
        return True
    tokens = lowered
    for separator in ",.!?:;()[]{}\"'\n\r\t":
        tokens = tokens.replace(separator, " ")
    return any(token in PREVIOUS_CONTEXT_WORDS for token in tokens.split())


def _is_self_contained_fresh_task(text: str | None) -> bool:
    if not text:
        return False
    lowered = text.casefold()
    if any(marker in lowered for marker in NEWS_TASK_MARKERS):
        return True
    if _has_previous_context_reference(lowered):
        return False
    return any(marker in lowered for marker in FRESH_TASK_MARKERS)


def _set_intent_state(ctx, raw_intent: TurnIntent, intent: TurnIntent) -> None:
    ctx.state["temp:turn_intent_route"] = raw_intent.route
    ctx.state["temp:turn_intent_confidence"] = raw_intent.confidence
    tts_requested = "tts" in intent.actions and _has_explicit_tts_request(
        ctx.state.get("temp:turn_current_text")
    )
    ctx.state["temp:tts_requested"] = tts_requested
    ctx.state[TTS_REQUESTED_FOR_TURN_KEY] = tts_requested
    ctx.state["temp:timezone"] = intent.timezone
    ctx.state["temp:minsk_time_enabled"] = intent.timezone == "Europe/Minsk"


def _set_previous_context_state(ctx, intent: TurnIntent) -> None:
    current_text = ctx.state.get("temp:turn_current_text")
    if intent.needs_previous_context and not _is_self_contained_fresh_task(current_text):
        return
    ctx.state["temp:turn_previous_text"] = None
    ctx.state["temp:turn_previous_summary"] = None
    ctx.state["temp:turn_previous_artifact_id"] = None


def _set_translation_state(ctx, target_language: str | None) -> None:
    ctx.state["temp:primary_route"] = "translation"
    ctx.state["temp:translation_target_language"] = target_language or "en"
    ctx.state["temp:translation_source_text"] = (
        ctx.state.get("temp:turn_current_text") or ""
    )


def _set_dictionary_state(
    ctx,
    *,
    word: str | None,
    sources: list[str] | None = None,
    slounik_dicts: list[str] | None = None,
    needs_word: bool = False,
) -> None:
    ctx.state["temp:primary_route"] = "dictionary"
    ctx.state["temp:dictionary_word"] = word
    ctx.state["temp:dictionary_sources"] = sources or []
    ctx.state["temp:slounik_dicts"] = slounik_dicts or []
    ctx.state["temp:dictionary_needs_word"] = needs_word


async def intent_policy_node(ctx, node_input):
    raw_intent = coerce_turn_intent(node_input)
    intent = _effective_intent(raw_intent)
    _set_intent_state(ctx, raw_intent, intent)
    _set_previous_context_state(ctx, intent)

    content = _current_content_from_state(ctx.state)
    pending_target = pending_translation_target(ctx.state)
    pending_dictionary = pending_dictionary_action(ctx.state)
    current_text = ctx.state.get("temp:turn_current_text")

    if intent.route == "cancel":
        ctx.state[PENDING_TEXT_ACTION_KEY] = None
        ctx.route = "cancel"
    elif pending_dictionary and current_text:
        _set_dictionary_state(
            ctx,
            word=current_text,
            sources=pending_dictionary.get("sources") or [],
            slounik_dicts=pending_dictionary.get("slounik_dicts") or [],
        )
        ctx.route = "dictionary"
    elif pending_target and current_text:
        _set_translation_state(ctx, pending_target)
        ctx.route = "translate"
    elif intent.route == "translation":
        _set_translation_state(ctx, intent.target_language)
        ctx.route = "translate"
    elif intent.route == "dictionary":
        _set_dictionary_state(
            ctx,
            word=intent.dictionary_word,
            sources=intent.dictionary_sources,
            slounik_dicts=intent.slounik_dicts,
            needs_word=intent.needs_dictionary_word or not intent.dictionary_word,
        )
        ctx.route = "dictionary"
    elif intent.route == "image":
        ctx.route = "image"
    elif intent.route == "direct":
        ctx.route = "default"
    else:
        ctx.route = "default"

    return content


async def input_policy_node(ctx, node_input):
    file_result = await file_policy_node(ctx, node_input)
    if isinstance(file_result, Event):
        return file_result

    default_intent = TurnIntent(route="default", confidence=1.0)
    _set_intent_state(ctx, default_intent, default_intent)
    ctx.route = "default"
    return _current_content_from_state(ctx.state)
