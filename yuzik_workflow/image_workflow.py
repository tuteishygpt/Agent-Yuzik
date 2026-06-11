from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any

import config
from google.adk.agents import LlmAgent
from google.adk.tools import ToolContext
from google.genai import types

from tools.gemini_image_generator import generate_image


@dataclass
class ImagePromptResult:
    prompt_en: str
    caption_be: str


image_prompt_agent = LlmAgent(
    name="image_prompt_agent",
    model=config.ROUTER_AGENT_MODEL,
    instruction=(
        "Translate the user's Belarusian/Russian/English image request into a "
        "clear English image-generation prompt. Also return a short Belarusian "
        "caption for the user. Return only the structured fields."
    ),
    output_schema=ImagePromptResult,
    tools=[],
)


async def default_build_image_prompt(text: str) -> ImagePromptResult:
    # The production graph calls the agent when wired through ADK. This fallback
    # keeps direct helper use deterministic in tests and emergency paths.
    return ImagePromptResult(prompt_en=text, caption_be="Малюнак гатовы.")


def coerce_image_prompt_result(value: Any) -> ImagePromptResult | None:
    if value is None:
        return None
    if isinstance(value, ImagePromptResult):
        return value
    if isinstance(value, Mapping):
        prompt_en = str(value.get("prompt_en") or "").strip()
        caption_be = str(value.get("caption_be") or "").strip()
        if prompt_en and caption_be:
            return ImagePromptResult(prompt_en=prompt_en, caption_be=caption_be)
    return None


async def execute_image_route(
    *,
    state: Any,
    tool_context: ToolContext,
    prompt_result: ImagePromptResult | Mapping[str, Any] | None = None,
    build_prompt: Callable[[str], Awaitable[ImagePromptResult]] = default_build_image_prompt,
    generate: Callable[..., Awaitable[types.Part]] = generate_image,
) -> list[types.Part]:
    text = state.get("temp:yuzik_text") or ""
    prompt = coerce_image_prompt_result(prompt_result)
    if prompt is None:
        prompt = await build_prompt(text)
    state["temp:image_prompt_en"] = prompt.prompt_en
    state["temp:primary_text"] = prompt.caption_be
    state["temp:primary_route"] = "image"

    if state.get("temp:tts_requested"):
        state["temp:tts_requested"] = False
        diagnostics = dict(state.get("temp:diagnostics") or {})
        diagnostics["tts_skipped_for_image"] = True
        state["temp:diagnostics"] = diagnostics

    image_part = await generate(prompt=prompt.prompt_en, tool_context=tool_context)
    parts = []
    if isinstance(image_part, types.Part):
        parts.append(image_part)
    return parts


async def execute_image_workflow(ctx, node_input):
    tool_context = ToolContext(
        ctx._invocation_context,
        event_actions=ctx.actions,
        parent_ctx=ctx,
        node=ctx._node,
    )
    parts = await execute_image_route(
        state=ctx.state,
        tool_context=tool_context,
        prompt_result=node_input,
    )
    caption = ctx.state.get("temp:primary_text")
    content_parts = []
    if caption:
        content_parts.append(types.Part(text=caption))
    content_parts.extend(parts)
    return types.Content(role="model", parts=content_parts)
