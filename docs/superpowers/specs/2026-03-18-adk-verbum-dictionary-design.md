# ADK Verbum Dictionary Tool Design

**Date:** 2026-03-18

**Goal:** Add a dedicated ADK dictionary tool that queries Verbum for Belarusian dictionary and grammar information, then returns a concise Belarusian summary instead of raw article dumps.

## Context

The active ADK routing path is centered in `router_agent/agent.py`, which already dispatches user requests to:

- `search_agent` for internet search
- `meme_agent` for meme generation
- `minsk_datetime_tool` for current Minsk date and time
- `weather_tool` for Belarus weather
- `synthesize_speech_tool` for Belarusian TTS
- `generate_image_tool` for image generation

The user wants:

- a new Verbum-backed dictionary tool in the existing ADK tool architecture
- one summarized Belarusian answer instead of full article texts
- dictionary-style requests routed directly to Verbum
- no fallback to `search_agent` when Verbum has no result

## Approved Architecture

Add a new tool module, `tools/verbum_tool.py`, implemented as an ADK `FunctionTool`, and wire it into `router_agent/agent.py`.

The new flow will be:

`router_agent` -> `tools.verbum_tool.verbum_tool` -> Verbum grammardb lookup -> fallback Verbum site search -> article extraction -> concise Belarusian summary

No new sub-agent is needed for the first version. `services/adk_service.py` stays unchanged because the Verbum path is text-only and does not require artifact handling.

## Tool Contract

The new tool should expose a narrow interface oriented around a dictionary lookup:

- `word`: the target word or short dictionary query

Behavior requirements:

- normalize the input text before lookup
- prefer the direct `grammardb` path when it yields dictionary or grammar content
- fall back to Verbum site search when `grammardb` has no useful result
- aggregate multiple matching article texts into one concise Belarusian answer
- avoid returning raw full-text dumps from Verbum
- return a short Belarusian "not found" message when Verbum has no result

Suggested callable shape:

`async def lookup_verbum(word: str) -> types.Part`

## External Data Flow

The tool should use the Verbum website in two stages:

1. Direct lookup against `https://verbum.by/grammardb/<word>`
2. Fallback search against `https://verbum.by/?q=<normalized-word>` and extraction of relevant article URLs

Implementation constraints:

- reuse existing project HTTP dependencies instead of adding a new package
- keep all HTML fetching and parsing logic inside `tools/verbum_tool.py`
- filter noisy links such as search pages, auth pages, tag pages, and feeds
- deduplicate repeated article texts before summarizing
- extract the most meaningful text block from each page instead of relying on brittle one-off selectors

## Router Behavior

Update `router_agent/agent.py` so the router instruction explicitly prefers `verbum_tool` for dictionary-related requests.

Required routing behavior:

- if the user asks for dictionary information, meaning, grammar, forms, spelling, or what Verbum says about a word, call `verbum_tool`
- keep the response flow in Belarusian
- do not use `search_agent` as fallback for the normal Verbum path
- if Verbum has no result, answer that Verbum has nothing for the requested word

## Summary Strategy

The tool should summarize extracted texts conservatively:

- prefer the direct grammar entry when it contains strong grammar markers
- if multiple articles are found, merge overlapping facts and remove duplication
- keep the result compact enough for chat and voice use
- emphasize the most useful facts first: part of speech, core meaning, notable forms, or brief usage notes
- avoid inventing details that do not appear in the extracted content

The first version should be heuristic and deterministic rather than model-generated inside the tool.

## Error Handling

The tool should return a short Belarusian text message when:

- no Verbum content can be found for the requested word
- the Verbum service is unavailable
- the response markup is incomplete or cannot be parsed into useful text

The tool must not fabricate dictionary definitions or grammar notes when the source data is missing.

## Testing

Add focused tests for:

- successful grammardb lookup producing a concise Belarusian summary
- fallback from grammardb to site search when grammardb has no useful result
- aggregation and deduplication of multiple article texts
- returning a clear "not found in Verbum" message when no results exist
- handling network or parsing failures without inventing content
- router wiring regression to ensure `verbum_tool` is imported, mentioned in the router instruction, and included in the router tools list
