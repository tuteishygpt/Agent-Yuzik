# Gemini Structured Outputs Design

## Goal

Replace fragile text-based JSON extraction in the teacher-mode Gemini adapter with SDK-enforced structured outputs via `response_schema=GeminiTeacherResult`.

## Current Problem

`api/teacher_mode/gemini_adapter.py` currently asks Gemini for JSON and then tries to recover it from `response.text` with `_parse_json_payload`. That flow is brittle:

- fenced code blocks and prose wrappers require cleanup code
- small formatting drift triggers a parse failure
- parse failures collapse into the generic unclear fallback

This is avoidable because the project already uses the new `google.genai` SDK, which supports typed structured outputs.

## Decision

Use `types.GenerateContentConfig(response_schema=GeminiTeacherResult, response_mime_type="application/json")` for both transcript and audio evaluation calls, and consume `response.parsed` instead of hand-parsing `response.text`.

## Scope

- Update transcript evaluation to request and consume structured output
- Update audio evaluation to request and consume structured output
- Keep `_normalize_payload` and the existing fallback path as defensive compatibility layers
- Remove `_parse_json_payload`, since cleanup heuristics are no longer the source of truth

## Risks And Mitigation

- If SDK parsing fails or returns no parsed payload, the adapter should raise into the existing fallback path
- Existing tests that stub raw dict payloads should keep working because normalization remains in place
- Audio flow must preserve the existing `input_understanding.transcript` backfill behavior

## Validation

- Add tests that intentionally provide invalid `response.text` but valid `response.parsed`
- Assert that the request config includes `response_schema=GeminiTeacherResult`
- Run the focused teacher-mode pytest file after implementation
