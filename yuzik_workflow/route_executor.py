from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from google.genai import types

from tools.weather_tool import get_weather
from yuzik_workflow.context import text_from_content
from yuzik_workflow.dictionary import DICTIONARY_WORD_REQUEST
from yuzik_workflow.policy import PENDING_TEXT_ACTION_KEY


VALID_ROUTES = {
    "chat",
    "search",
    "weather",
    "dictionary",
    "image",
    "translate",
    "direct",
    "cancel",
}
VALID_POST_ACTIONS = {"tts"}
DEFAULT_PLAN_CONFIDENCE_THRESHOLD = 0.6


def _field(value: Any, name: str, default: Any = None) -> Any:
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


def _str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _dict(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def _coerce_plan(value: Any) -> dict[str, Any]:
    try:
        from yuzik_workflow.routing_plan import coerce_routing_plan

        plan = coerce_routing_plan(value)
        return {
            "route": _field(plan, "route", "chat"),
            "target_text_ref": _field(plan, "target_text_ref", "current_text"),
            "post_actions": list(_field(plan, "post_actions", []) or []),
            "pending_action_update": _field(plan, "pending_action_update", None),
            "confidence": _coerce_confidence(_field(plan, "confidence", 0.0)),
            "rationale": _field(plan, "rationale", ""),
            "tools": list(_field(plan, "tools", []) or []),
        }
    except Exception:
        parsed = _parse_json_object(value)
        route = str(_field(parsed, "route", "chat") or "chat").strip()
        if route not in VALID_ROUTES:
            route = "chat"
        return {
            "route": route,
            "target_text_ref": str(
                _field(parsed, "target_text_ref", "current_text") or "current_text"
            ),
            "post_actions": [
                action
                for action in _str_list(_field(parsed, "post_actions", []))
                if action in VALID_POST_ACTIONS
            ],
            "pending_action_update": _field(parsed, "pending_action_update", None),
            "confidence": _coerce_confidence(_field(parsed, "confidence", 0.0)),
            "rationale": str(_field(parsed, "rationale", "") or ""),
            "tools": _str_list(_field(parsed, "tools", [])),
        }


def _current_content_from_state(state: dict[str, Any]) -> types.Content:
    content = state.get("temp:turn_current_content")
    if isinstance(content, types.Content):
        return content
    text = state.get("temp:turn_current_text")
    return types.Content(role="user", parts=[types.Part(text=str(text or ""))])


def _context_ref_text(state: dict[str, Any], ref: str) -> str:
    if ref == "previous_assistant_text":
        return str(state.get("temp:turn_previous_text") or "")
    if ref == "rolling_summary":
        return str(state.get("user:rolling_summary") or "")
    if ref == "previous_assistant_summary":
        return str(state.get("temp:turn_previous_summary") or "")
    state_text = state.get("temp:turn_current_text")
    if isinstance(state_text, str) and state_text.strip():
        return state_text.strip()
    content = _current_content_from_state(state)
    return text_from_content(content) or ""


def _record_diagnostics(
    state: dict[str, Any],
    plan: dict[str, Any],
    *,
    branch: str,
    fallback_reason: str | None = None,
) -> None:
    diagnostics = dict(state.get("temp:routing_diagnostics") or {})
    diagnostics.update(
        {
            "route": plan["route"],
            "executor_branch": branch,
            "confidence": plan["confidence"],
            "target_text_ref": plan["target_text_ref"],
            "tools": list(plan["tools"]),
        }
    )
    if plan["rationale"]:
        diagnostics["rationale"] = plan["rationale"][:240]
    if fallback_reason:
        diagnostics["fallback_reason"] = fallback_reason
    state["temp:routing_diagnostics"] = diagnostics


def _apply_tts_post_action(state: dict[str, Any], plan: dict[str, Any]) -> None:
    requested = "tts" in plan["post_actions"]
    state["temp:tts_requested"] = requested
    state["user:tts_requested_for_turn"] = requested


def _dictionary_word(update: dict[str, Any]) -> str | None:
    for key in ("dictionary_word", "word"):
        value = update.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _model_text(text: str) -> types.Content:
    return types.Content(role="model", parts=[types.Part(text=text)])


def _int_value(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


async def route_executor_node(ctx, node_input):
    plan = _coerce_plan(node_input)
    state = ctx.state
    content = _current_content_from_state(state)
    route = plan["route"]

    if (
        plan["confidence"] < DEFAULT_PLAN_CONFIDENCE_THRESHOLD
        and route not in {"direct", "cancel"}
    ):
        plan["route"] = "chat"
        state["temp:primary_route"] = "chat"
        ctx.route = "chat"
        _record_diagnostics(state, plan, branch="chat", fallback_reason="low_confidence")
        return content

    if route == "cancel":
        state[PENDING_TEXT_ACTION_KEY] = None
        state["temp:creation_cancelled"] = True
        state["temp:tts_requested"] = False
        state["user:tts_requested_for_turn"] = False
        state["temp:primary_route"] = "cancel"
        ctx.route = "cancel"
        _record_diagnostics(state, plan, branch="cancel")
        return _model_text("Запыт скасаваны.")

    if route == "dictionary":
        update = _dict(plan["pending_action_update"])
        word = _dictionary_word(update)
        sources = _str_list(update.get("sources"))
        slounik_dicts = _str_list(update.get("slounik_dicts"))
        if not word:
            state[PENDING_TEXT_ACTION_KEY] = {
                "kind": "dictionary",
                "sources": sources,
                "slounik_dicts": slounik_dicts,
            }
            state["temp:primary_route"] = "direct"
            ctx.route = "direct"
            _record_diagnostics(
                state,
                plan,
                branch="direct",
                fallback_reason="missing_dictionary_word",
            )
            return types.Content(
                role="model",
                parts=[types.Part(text=DICTIONARY_WORD_REQUEST)],
            )

        state[PENDING_TEXT_ACTION_KEY] = None
        state["temp:primary_route"] = "dictionary"
        state["temp:dictionary_word"] = word
        state["temp:dictionary_sources"] = sources
        state["temp:slounik_dicts"] = slounik_dicts
        state["temp:dictionary_needs_word"] = False
        ctx.route = "dictionary"
        _record_diagnostics(state, plan, branch="dictionary")
        return content

    if route == "translate":
        update = _dict(plan["pending_action_update"])
        state["temp:primary_route"] = "translation"
        state["temp:translation_target_language"] = (
            str(update.get("target_language") or "en").strip() or "en"
        )
        state["temp:translation_source_text"] = _context_ref_text(
            state, plan["target_text_ref"]
        )
        ctx.route = "translate"
        _apply_tts_post_action(state, plan)
        _record_diagnostics(state, plan, branch="translate")
        return content

    if route == "weather":
        update = _dict(plan["pending_action_update"])
        state["temp:primary_route"] = "weather"
        state["temp:weather_city"] = str(update.get("city") or "").strip()
        state["temp:weather_forecast_days"] = _int_value(
            update.get("forecast_days"), 1
        )
        ctx.route = "weather"
        _apply_tts_post_action(state, plan)
        _record_diagnostics(state, plan, branch="weather")
        return content

    if route == "search":
        update = _dict(plan["pending_action_update"])
        query = str(update.get("query") or "").strip()
        if not query:
            query = _context_ref_text(state, plan["target_text_ref"])
        state["temp:primary_route"] = "search"
        state["temp:search_query"] = query
        ctx.route = "search"
        _apply_tts_post_action(state, plan)
        _record_diagnostics(state, plan, branch="search")
        return content

    if route == "image":
        state["temp:primary_route"] = "image"
        state["temp:tts_requested"] = False
        state["user:tts_requested_for_turn"] = False
        ctx.route = "image"
        _record_diagnostics(state, plan, branch="image")
        state["temp:routing_diagnostics"]["tts_skipped_for_image"] = (
            "tts" in plan["post_actions"]
        )
        return content

    if route == "direct":
        update = _dict(plan["pending_action_update"])
        direct_answer = str(
            update.get("direct_answer")
            or update.get("clarification")
            or "Удакладні, калі ласка, што трэба зрабіць."
        ).strip()
        state["temp:primary_route"] = "direct"
        state["temp:primary_text"] = direct_answer
        ctx.route = "direct"
        _apply_tts_post_action(state, plan)
        _record_diagnostics(state, plan, branch="direct")
        return _model_text(direct_answer)

    state["temp:primary_route"] = route
    ctx.route = route
    _apply_tts_post_action(state, plan)
    _record_diagnostics(state, plan, branch=route)
    return content


async def weather_lookup_node(ctx, node_input):
    _ = node_input
    city = str(ctx.state.get("temp:weather_city") or "").strip()
    forecast_days = _int_value(ctx.state.get("temp:weather_forecast_days"), 1)
    part = await get_weather(city=city, forecast_days=forecast_days)
    if isinstance(part, types.Part):
        text = getattr(part, "text", None)
        if text:
            ctx.state["temp:primary_text"] = text
            ctx.state["temp:tool_result_summary"] = text
        return types.Content(role="model", parts=[part])
    return part


async def search_query_node(ctx, node_input):
    query = str(ctx.state.get("temp:search_query") or "").strip()
    if not query:
        return node_input
    return types.Content(role="user", parts=[types.Part(text=query)])
