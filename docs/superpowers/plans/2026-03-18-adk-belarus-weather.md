# ADK Belarus Weather Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an ADK weather tool that returns current weather and a short one-to-three-day forecast for Belarus cities, defaulting to Minsk when the user does not specify a city.

**Architecture:** Add a new async `tools/weather_tool.py` module backed by Open-Meteo geocoding and forecast endpoints, keeping all provider-specific logic and Belarusian formatting inside the tool. Wire `router_agent` to prefer this tool for weather queries, and cover the path with focused pytest tests plus a router regression check.

**Tech Stack:** Python, `aiohttp`, Google ADK `FunctionTool`, pytest

---

## File Structure

- `tools/weather_tool.py`
  Own the complete weather path: city normalization, Belarus-only geocoding, forecast fetch, weather-code-to-text mapping, Belarusian response formatting, and `weather_tool = FunctionTool(get_weather)`.
- `router_agent/agent.py`
  Import the new tool, add it to the tool list, and update the router instruction so weather requests go through `weather_tool` with Minsk as the implicit default city.
- `tests/test_weather_tool.py`
  Unit coverage for the tool contract and error handling using monkeypatched async helpers instead of real HTTP requests.
- `tests/test_gemini_model_aliases.py`
  Regression coverage for router wiring so the weather tool stays imported and mentioned in router instructions.

Do not modify `services/adk_service.py`, `config.py`, or `requirements.txt` unless implementation proves a concrete gap. Execute with `@test-driven-development`, and use `@verification-before-completion` before claiming the work is done.

## Chunk 1: Weather tool

### Task 1: Add failing tests for the weather tool

**Files:**
- Create: `tests/test_weather_tool.py`
- Test: `tests/test_weather_tool.py`

- [ ] **Step 1: Write the failing tests**

```python
import asyncio
import importlib
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def _load_module():
    sys.modules.pop("tools.weather_tool", None)
    return importlib.import_module("tools.weather_tool")


def test_get_weather_defaults_to_minsk_and_clamps_forecast_days(monkeypatch):
    module = _load_module()
    captured = {}

    async def fake_resolve_city(city_query):
        captured["city_query"] = city_query
        return {"name": "Minsk", "latitude": 53.9, "longitude": 27.56}

    async def fake_fetch_forecast(*, latitude, longitude, forecast_days):
        captured["forecast_days"] = forecast_days
        return {
            "current": {"temperature_2m": 5.0, "apparent_temperature": 2.0, "wind_speed_10m": 3.0, "weather_code": 1},
            "daily": {"time": ["2026-03-18"], "temperature_2m_max": [7.0], "temperature_2m_min": [1.0], "weather_code": [3]},
        }

    monkeypatch.setattr(module, "_resolve_belarus_city", fake_resolve_city)
    monkeypatch.setattr(module, "_fetch_weather_forecast", fake_fetch_forecast)

    result = asyncio.run(module.get_weather(city="", forecast_days=7))

    assert captured["city_query"] == "Minsk"
    assert captured["forecast_days"] == 3
    assert "Мінску" in result.text


def test_get_weather_returns_not_found_message_for_unknown_city(monkeypatch):
    module = _load_module()

    async def fake_resolve_city(city_query):
        return None

    monkeypatch.setattr(module, "_resolve_belarus_city", fake_resolve_city)

    result = asyncio.run(module.get_weather(city="Atlantis", forecast_days=2))

    assert "Беларус" in result.text


def test_get_weather_returns_service_error_message(monkeypatch):
    module = _load_module()

    async def fake_resolve_city(city_query):
        return {"name": "Brest", "latitude": 52.1, "longitude": 23.7}

    async def fake_fetch_forecast(**kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(module, "_resolve_belarus_city", fake_resolve_city)
    monkeypatch.setattr(module, "_fetch_weather_forecast", fake_fetch_forecast)

    result = asyncio.run(module.get_weather(city="Brest", forecast_days=2))

    assert "Не ўдалося атрымаць" in result.text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_weather_tool.py -v`
Expected: FAIL because `tools.weather_tool` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```python
async def get_weather(city: str = "", forecast_days: int = 1):
    city_query = (city or "").strip() or "Minsk"
    days = max(1, min(int(forecast_days or 1), 3))
    try:
        place = await _resolve_belarus_city(city_query)
        if not place:
            return types.Part(text="Не ўдалося знайсці гэты населены пункт у Беларусі. Удакладні назву.")
        forecast = await _fetch_weather_forecast(
            latitude=place["latitude"],
            longitude=place["longitude"],
            forecast_days=days,
        )
        return types.Part(text=_format_weather_reply(place["name"], forecast, days))
    except Exception:
        return types.Part(text="Не ўдалося атрымаць даныя пра надвор'е. Паспрабуй крыху пазней.")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_weather_tool.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/test_weather_tool.py tools/weather_tool.py
git commit -m "feat: add Belarus weather ADK tool"
```

### Task 2: Fill in weather formatting and Open-Meteo integration details

**Files:**
- Modify: `tools/weather_tool.py`
- Modify: `tests/test_weather_tool.py`
- Test: `tests/test_weather_tool.py`

- [ ] **Step 1: Add the next failing tests**

```python
def test_get_weather_formats_current_conditions_and_daily_forecast(monkeypatch):
    ...
    assert "адчуваецца" in result.text
    assert "вецер" in result.text
    assert "Прагноз" in result.text


def test_resolve_belarus_city_rejects_non_belarus_results(monkeypatch):
    ...
    assert result is None
```

- [ ] **Step 2: Run targeted tests to verify they fail**

Run: `pytest tests/test_weather_tool.py::test_get_weather_formats_current_conditions_and_daily_forecast tests/test_weather_tool.py::test_resolve_belarus_city_rejects_non_belarus_results -v`
Expected: FAIL because the formatter and Belarus-only filtering are still incomplete.

- [ ] **Step 3: Write minimal implementation**

```python
WEATHER_CODE_LABELS = {
    0: "ясна",
    1: "пераважна ясна",
    2: "пераменная воблачнасць",
    3: "пахмурна",
    ...
}


async def _resolve_belarus_city(city_query: str) -> dict | None:
    ...
    if item.get("country_code") != "BY":
        continue
    return {
        "name": item["name"],
        "latitude": item["latitude"],
        "longitude": item["longitude"],
    }


def _format_weather_reply(city_name: str, forecast: dict, forecast_days: int) -> str:
    return (
        f"Зараз у {city_name} ... "
        f"Прагноз на найбліжэйшыя {forecast_days} дні: ..."
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_weather_tool.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/test_weather_tool.py tools/weather_tool.py
git commit -m "feat: format Belarus weather responses"
```

## Chunk 2: Router wiring and verification

### Task 3: Add router regression coverage for weather routing

**Files:**
- Modify: `tests/test_gemini_model_aliases.py`
- Test: `tests/test_gemini_model_aliases.py`

- [ ] **Step 1: Write the failing regression test**

```python
def test_router_agent_imports_weather_tool_and_mentions_minsk_default():
    path = REPO_ROOT / "router_agent" / "agent.py"
    text = path.read_text(encoding="utf-8")
    assert "from tools.weather_tool import weather_tool" in text
    assert "`weather_tool`" in text
    assert "Мінск" in text
    assert "weather_tool," in text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_gemini_model_aliases.py::test_router_agent_imports_weather_tool_and_mentions_minsk_default -v`
Expected: FAIL because `router_agent` does not yet mention the weather tool.

- [ ] **Step 3: Write minimal implementation**

```python
from tools.weather_tool import weather_tool

...
â€¢ Калі пытаюцца пра надвор'е або прагноз — выклікай `weather_tool`. Калі горад не названы, выкарыстоўвай Мінск.

...
weather_tool,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_gemini_model_aliases.py::test_router_agent_imports_weather_tool_and_mentions_minsk_default -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add router_agent/agent.py tests/test_gemini_model_aliases.py
git commit -m "feat: route Belarus weather queries through ADK tool"
```

### Task 4: Run focused verification

**Files:**
- Modify: none
- Test: `tests/test_weather_tool.py`
- Test: `tests/test_gemini_model_aliases.py`
- Test: `tests/test_gemini_image_generator.py`

- [ ] **Step 1: Run focused verification**

Run: `pytest tests/test_weather_tool.py tests/test_gemini_model_aliases.py -v`
Expected: PASS

- [ ] **Step 2: Run a broader router-adjacent safety check**

Run: `pytest tests/test_gemini_image_generator.py -v`
Expected: PASS and no regression in the existing Gemini image tool path.

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "test: verify Belarus weather integration"
```
