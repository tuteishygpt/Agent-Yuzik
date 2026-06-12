from __future__ import annotations

from typing import Any

from google.adk.events import Event
from google.genai import types

from services.gemini_file_policy import validate_gemini_chat_file
from yuzik_workflow.context import TurnContext, detect_language, text_from_content


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


def coerce_turn_context(node_input: Any) -> TurnContext:
    if isinstance(node_input, TurnContext):
        return node_input
    content = (
        node_input
        if isinstance(node_input, types.Content)
        else types.Content(role="user", parts=[types.Part(text=str(node_input))])
    )
    text = text_from_content(content)
    return TurnContext(
        current_content=content,
        current_text=text,
        previous_text=None,
        previous_summary=None,
        previous_artifact_id=None,
        language=detect_language(text),
    )


def store_turn_context_state(ctx, turn: TurnContext, policy: dict[str, Any]) -> None:
    file_part_count = sum(
        1
        for part in (turn.current_content.parts or [])
        if getattr(part, "inline_data", None) is not None
    )
    if turn.current_text:
        ctx.state["temp:yuzik_text"] = turn.current_text
    ctx.state["temp:turn_current_content"] = turn.current_content
    ctx.state["temp:turn_current_text"] = turn.current_text
    ctx.state["temp:turn_previous_text"] = turn.previous_text
    ctx.state["temp:turn_previous_summary"] = turn.previous_summary
    ctx.state["temp:turn_previous_artifact_id"] = turn.previous_artifact_id
    ctx.state["temp:turn_language"] = turn.language
    ctx.state["temp:turn_has_file_parts"] = file_part_count > 0
    ctx.state["temp:turn_file_part_count"] = file_part_count
    for key, value in policy.items():
        ctx.state[f"temp:{key}"] = value


async def file_policy_node(ctx, node_input):
    turn = coerce_turn_context(node_input)
    policy = evaluate_file_policy(turn.current_content)
    store_turn_context_state(ctx, turn, policy)

    if not policy["file_ok"]:
        ctx.route = "file_error"
        ctx.state["temp:primary_route"] = "fallback"
        ctx.state["temp:primary_text"] = policy["file_error"]
        return Event(
            content=types.Content(
                role="model",
                parts=[types.Part(text=policy["file_error"])],
            )
        )

    return turn
