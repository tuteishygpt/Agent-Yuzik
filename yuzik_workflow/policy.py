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


def _set_intent_state(ctx, raw_intent: TurnIntent, intent: TurnIntent) -> None:
    ctx.state["temp:turn_intent_route"] = raw_intent.route
    ctx.state["temp:turn_intent_confidence"] = raw_intent.confidence
    tts_requested = "tts" in intent.actions
    ctx.state["temp:tts_requested"] = tts_requested
    ctx.state[TTS_REQUESTED_FOR_TURN_KEY] = tts_requested
    ctx.state["temp:timezone"] = intent.timezone
    ctx.state["temp:minsk_time_enabled"] = intent.timezone == "Europe/Minsk"


def _set_translation_state(ctx, target_language: str | None) -> None:
    ctx.state["temp:primary_route"] = "translation"
    ctx.state["temp:translation_target_language"] = target_language or "en"
    ctx.state["temp:translation_source_text"] = (
        ctx.state.get("temp:turn_current_text") or ""
    )


async def intent_policy_node(ctx, node_input):
    raw_intent = coerce_turn_intent(node_input)
    intent = _effective_intent(raw_intent)
    _set_intent_state(ctx, raw_intent, intent)

    content = _current_content_from_state(ctx.state)
    pending_target = pending_translation_target(ctx.state)
    current_text = ctx.state.get("temp:turn_current_text")

    if intent.route == "cancel":
        ctx.state[PENDING_TEXT_ACTION_KEY] = None
        ctx.route = "cancel"
    elif pending_target and current_text:
        _set_translation_state(ctx, pending_target)
        ctx.route = "translate"
    elif intent.route == "translation":
        _set_translation_state(ctx, intent.target_language)
        ctx.route = "translate"
    elif intent.route == "image":
        ctx.route = "image"
    elif intent.route == "direct":
        ctx.state["temp:primary_route"] = "direct"
        ctx.route = "direct"
    else:
        ctx.route = "default"

    return content


async def input_policy_node(ctx, node_input):
    file_result = await file_policy_node(ctx, node_input)
    if isinstance(file_result, Event):
        return file_result
    return await intent_policy_node(ctx, {"route": "default", "confidence": 1.0})
