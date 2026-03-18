# ADK Belarus Weather Design

**Date:** 2026-03-18

**Goal:** Add a dedicated ADK weather tool that returns current weather and a short one-to-three-day forecast for cities in Belarus, using Minsk as the default city when the user does not specify one.

## Context

The active ADK routing path is centered in `router_agent/agent.py`, which already dispatches user requests to:

- `search_agent` for internet search
- `meme_agent` for meme generation
- `synthesize_speech_tool` for Belarusian TTS
- `generate_image_tool` for image generation

The user wants:

- current weather for any city in Belarus
- a short one-to-three-day forecast
- Minsk used by default when no city is given
- Belarusian output from the assistant

## Approved Architecture

Add a new tool module, `tools/weather_tool.py`, implemented as an ADK `FunctionTool`, and wire it into `router_agent/agent.py`.

The new flow will be:

`router_agent` -> `tools.weather_tool.weather_tool` -> Belarus-only geocoding lookup -> weather forecast lookup -> Belarusian text response

`services/adk_service.py` stays unchanged because the weather path is text-only and does not require special artifact handling.

## Tool Contract

The new weather tool should expose a narrow interface oriented around the user request:

- `city`: optional city name
- `forecast_days`: optional requested forecast length

Behavior requirements:

- when `city` is empty or omitted, use `Minsk`
- restrict lookup to Belarus and select a Belarus result even when the input uses Belarusian, Russian, or Latin-script city names
- clamp `forecast_days` to the range `1..3`
- always include current weather
- include a short daily forecast for the requested number of days
- return a concise Belarusian text response suitable for chat and voice playback

## External Data Flow

The tool should use Open-Meteo in two steps:

1. Geocoding request to resolve the city to Belarus coordinates
2. Forecast request to fetch current conditions and daily forecast data

Implementation constraints:

- prefer existing project HTTP libraries instead of adding a new dependency
- use stable structured API fields rather than parsing search results
- keep all provider-specific logic inside `tools/weather_tool.py`

## Router Behavior

Update `router_agent/agent.py` so the router instruction explicitly prefers `weather_tool` for weather and forecast requests before falling back to `search_agent`.

Required routing behavior:

- if the user asks about weather, temperature, rain, wind, or forecast, call `weather_tool`
- if no city is present, treat the request as being about Minsk
- do not use `search_agent` for the normal Belarus weather path in the first version

## Error Handling

The tool should return a short Belarusian text message when:

- the city cannot be found in Belarus
- the external weather service is unavailable
- the service response is incomplete or invalid

The tool must not invent weather details when external data is missing.

## Output Shape

The response should stay compact and consistent:

- current conditions first
- then a short forecast by day
- plain Belarusian wording, suitable for TTS
- avoid terse symbols that sound unnatural in voice output
- current conditions should include condition summary, air temperature, feels-like temperature if available, and wind
- each forecast day should include day label, min/max temperature, and a short condition summary

Suggested response shape:

`Зараз у Мінску ... . Прагноз на найбліжэйшыя N дні: ...`

## Testing

Add focused tests for:

- defaulting to Minsk when no city is provided
- successful lookup for a Belarus city
- rejecting or explaining a city that is not found in Belarus
- handling external API failures without fabricating weather data
- clamping forecast length to at most three days
- router wiring regression to ensure `weather_tool` is present and mentioned in the router instruction
