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
            "current": {
                "temperature_2m": 5.0,
                "apparent_temperature": 2.0,
                "wind_speed_10m": 3.0,
                "weather_code": 1,
            },
            "daily": {
                "time": ["2026-03-18"],
                "temperature_2m_max": [7.0],
                "temperature_2m_min": [1.0],
                "weather_code": [3],
            },
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
