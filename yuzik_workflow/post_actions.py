from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from google.adk.tools import ToolContext
from google.genai import types

from tools.text_to_speech_tool import synthesize_speech


def text_from_parts(parts: list[types.Part]) -> str | None:
    text = "\n".join(part.text for part in parts if getattr(part, "text", None)).strip()
    return text or None


def _record_post_action_diagnostics(
    state: Any,
    *,
    requested: bool,
    executed: bool,
    skipped: bool,
    skip_reason: str | None,
) -> None:
    diagnostics = dict(state.get("temp:post_action_diagnostics") or {})
    diagnostics["tts"] = {
        "requested": requested,
        "executed": executed,
        "skipped": skipped,
        "skip_reason": skip_reason,
    }
    state["temp:post_action_diagnostics"] = diagnostics


async def maybe_run_tts_post_action(
    *,
    state: Any,
    parts: list[types.Part],
    tool_context: ToolContext,
    synthesize: Callable[..., Awaitable[types.Part]] = synthesize_speech,
) -> list[types.Part]:
    requested = bool(state.get("temp:tts_requested"))
    if not requested:
        _record_post_action_diagnostics(
            state,
            requested=False,
            executed=False,
            skipped=True,
            skip_reason="not_requested",
        )
        return parts
    if state.get("temp:creation_cancelled"):
        _record_post_action_diagnostics(
            state,
            requested=True,
            executed=False,
            skipped=True,
            skip_reason="creation_cancelled",
        )
        return parts

    text = state.get("temp:primary_text") or text_from_parts(parts)
    if not text:
        _record_post_action_diagnostics(
            state,
            requested=True,
            executed=False,
            skipped=True,
            skip_reason="no_text",
        )
        return parts

    audio_part = await synthesize(text=text, tool_context=tool_context)
    if not isinstance(audio_part, types.Part):
        _record_post_action_diagnostics(
            state,
            requested=True,
            executed=False,
            skipped=True,
            skip_reason="invalid_audio",
        )
        return parts

    parts.append(audio_part)
    artifact_delta = dict(state.get("temp:artifact_delta") or {})
    artifact_delta.setdefault("tts_output.wav", 0)
    state["temp:artifact_delta"] = artifact_delta
    state["temp:tts_requested"] = False
    _record_post_action_diagnostics(
        state,
        requested=True,
        executed=True,
        skipped=False,
        skip_reason=None,
    )
    return parts


async def post_action_node(ctx, node_input):
    parts = list(getattr(node_input, "parts", None) or [])
    tool_context = ToolContext(
        ctx._invocation_context,
        event_actions=ctx.actions,
        parent_ctx=ctx,
        node=ctx._node,
    )
    await maybe_run_tts_post_action(
        state=ctx.state,
        parts=parts,
        tool_context=tool_context,
    )
    if isinstance(node_input, types.Content):
        return types.Content(role=node_input.role or "model", parts=parts)
    if parts:
        return types.Content(role="model", parts=parts)
    return node_input
