from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field, is_dataclass
from typing import Any, Literal, Mapping


RouteName = Literal[
    "chat",
    "search",
    "weather",
    "dictionary",
    "image",
    "translate",
    "direct",
    "cancel",
]
TargetTextRef = Literal[
    "current_text",
    "previous_assistant_text",
    "rolling_summary",
    "artifact",
    "none",
]
PostAction = Literal["tts"]
AnswerStyle = Literal["normal", "brief", "tool_result"]

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
VALID_TARGET_TEXT_REFS = {
    "current_text",
    "previous_assistant_text",
    "rolling_summary",
    "artifact",
    "none",
}
VALID_TOOLS = {
    "search",
    "weather",
    "dictionary",
    "image_generation",
    "translate",
    "translation",
}
VALID_POST_ACTIONS = {"tts"}
VALID_ANSWER_STYLES = {"normal", "brief", "tool_result"}

FALLBACK_RATIONALE = "Invalid routing planner output; fallback to chat."


@dataclass
class RoutingPlan:
    route: RouteName = "chat"
    needs_previous_context: bool = False
    target_text_ref: TargetTextRef = "current_text"
    artifact_ref: str | None = None
    tools: list[str] = field(default_factory=list)
    post_actions: list[PostAction] = field(default_factory=list)
    pending_action_update: dict[str, Any] | None = None
    answer_style: AnswerStyle = "normal"
    confidence: float = 0.0
    rationale: str = FALLBACK_RATIONALE


def _fallback_plan() -> RoutingPlan:
    return RoutingPlan()


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
        return None
    return parsed if isinstance(parsed, Mapping) else None


def _mapping_from_value(value: Any) -> Mapping[str, Any] | None:
    parsed = _parse_json_object(value)
    if parsed is None:
        return None
    value = parsed
    if isinstance(value, RoutingPlan):
        return asdict(value)
    if isinstance(value, Mapping):
        return value
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        dumped = model_dump()
        return dumped if isinstance(dumped, Mapping) else None
    if is_dataclass(value):
        dumped = asdict(value)
        return dumped if isinstance(dumped, Mapping) else None
    return None


def _coerce_confidence(value: Any) -> float:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return 0.0
    return min(1.0, max(0.0, confidence))


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y"}
    return bool(value)


def _coerce_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _coerce_filtered_list(value: Any, valid_values: set[str]) -> list[str]:
    if not isinstance(value, list):
        return []
    result = []
    for item in value:
        if not isinstance(item, str):
            continue
        item = item.strip()
        if item and item in valid_values:
            result.append(item)
    return result


def coerce_routing_plan(value: Any) -> RoutingPlan:
    payload = _mapping_from_value(value)
    if payload is None:
        return _fallback_plan()

    route = payload.get("route", "chat")
    if route not in VALID_ROUTES:
        return _fallback_plan()

    target_text_ref = payload.get("target_text_ref", "current_text")
    if target_text_ref not in VALID_TARGET_TEXT_REFS:
        target_text_ref = "current_text"

    answer_style = payload.get("answer_style", "normal")
    if answer_style not in VALID_ANSWER_STYLES:
        answer_style = "normal"

    pending_action_update = payload.get("pending_action_update")
    if pending_action_update is not None:
        pending_action_update = (
            dict(pending_action_update)
            if isinstance(pending_action_update, Mapping)
            else None
        )

    return RoutingPlan(
        route=route,
        needs_previous_context=_coerce_bool(payload.get("needs_previous_context", False)),
        target_text_ref=target_text_ref,
        artifact_ref=_coerce_str(payload.get("artifact_ref")),
        tools=_coerce_filtered_list(payload.get("tools", []), VALID_TOOLS),
        post_actions=_coerce_filtered_list(
            payload.get("post_actions", []), VALID_POST_ACTIONS
        ),
        pending_action_update=pending_action_update,
        answer_style=answer_style,
        confidence=_coerce_confidence(payload.get("confidence", 0.0)),
        rationale=_coerce_str(payload.get("rationale")) or FALLBACK_RATIONALE,
    )
