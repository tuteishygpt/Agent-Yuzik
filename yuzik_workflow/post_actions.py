from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from google.adk.tools import ToolContext
from google.genai import types

from tools.text_to_speech_tool import synthesize_speech


def text_from_parts(parts: list[types.Part]) -> str | None:
    text = "\n".join(part.text for part in parts if getattr(part, "text", None)).strip()
    return text or None


async def maybe_run_tts_post_action(
    *,
    state: Any,
    parts: list[types.Part],
    tool_context: ToolContext,
    synthesize: Callable[..., Awaitable[types.Part]] = synthesize_speech,
) -> list[types.Part]:
    if not state.get("temp:tts_requested"):
        return parts
    if state.get("temp:creation_cancelled"):
        return parts

    text = state.get("temp:primary_text") or text_from_parts(parts)
    if not text:
        return parts

    audio_part = await synthesize(text=text, tool_context=tool_context)
    if not isinstance(audio_part, types.Part):
        return parts

    parts.append(audio_part)
    artifact_delta = dict(state.get("temp:artifact_delta") or {})
    artifact_delta.setdefault("tts_output.wav", 0)
    state["temp:artifact_delta"] = artifact_delta
    state["temp:tts_requested"] = False
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
