# ADK Gemini Image Generation Design

**Date:** 2026-03-18

**Goal:** Replace the active ADK image generation path that currently uses Fal with a Gemini-based image generator, while keeping the old Fal implementation in the repository but no longer wired into the router agent.

## Context

The active image-generation route is:

- `router_agent/agent.py` imports `generate_image_tool` from `tools/flux_generator.py`
- `tools/flux_generator.py` calls `fal_client.run(...)`
- `services/adk_service.py` already handles image artifacts generically and does not need provider-specific changes

The user wants:

- Fal image generation disabled in ADK
- Gemini image generation enabled via `gemini-2.5-flash-image`
- model selection overridable via `.env`
- old Fal code preserved in the repo, but unused

## Approved Architecture

Add a new tool module, `tools/gemini_image_generator.py`, and switch `router_agent/agent.py` to import that tool instead of the Fal-backed one.

The new flow will be:

`router_agent` -> `tools.gemini_image_generator.generate_image_tool` -> `tool_context.save_artifact(...)` -> existing ADK artifact/image delivery

`services/adk_service.py` stays unchanged because it already forwards image artifacts produced by ADK tools.

## Tool Contract

The new Gemini tool keeps the old public signature for compatibility:

- `prompt`
- `number_of_images`
- `aspect_ratio`
- `person_generation`
- `output_mime_type`
- `tool_context`

Behavior differences:

- `gemini-2.5-flash-image` through `generate_content(...)` supports `aspect_ratio`, `output_mime_type`, and `person_generation` via `types.ImageConfig`
- `number_of_images` is not supported on this Gemini path
- the tool must reject `number_of_images != 1` with a clear text error instead of silently ignoring it

## Configuration

Add `IMAGE_GENERATION_MODEL` to environment-backed config.

Requirements:

- `.env` includes `IMAGE_GENERATION_MODEL=gemini-2.5-flash-image`
- `config.py` exposes `IMAGE_GENERATION_MODEL = os.getenv("IMAGE_GENERATION_MODEL")`
- the new tool uses `config.IMAGE_GENERATION_MODEL` and falls back to `gemini-2.5-flash-image` if unset

This keeps the versioned default out of `config.py`, which aligns with the repository's existing alias test constraints on that file.

## Error Handling

The tool should return `types.Part(text=...)` when:

- `number_of_images != 1`
- no Gemini API key is configured
- Gemini returns no image parts
- Gemini call raises an exception

The tool should save the first image artifact when Gemini returns multiple parts and ignore non-image parts.

## Testing

Add focused tests for:

- rejecting unsupported `number_of_images`
- selecting the configured model from `.env`/config
- saving the first returned image artifact
- returning a text error when Gemini produces no image bytes

## Sources

- [Gemini image generation guide](https://ai.google.dev/gemini-api/docs/image-generation)
- [Google Gen AI Python SDK docs](https://googleapis.github.io/python-genai/)
- [Gemini models docs](https://ai.google.dev/gemini-api/docs/models)
