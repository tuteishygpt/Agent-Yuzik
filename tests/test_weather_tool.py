import asyncio
import importlib
import os
import sys


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def _load_module():
    sys.modules.pop("tools.weather_tool", None)
    return importlib.import_module("tools.weather_tool")


def test_get_weather_accepts_lida_locative_and_formats_city_name(monkeypatch):
    module = _load_module()
    captured = {}

    async def fake_resolve_city(city_query):
        captured["city_query"] = city_query
        return {
            "name": "\u041b\u0456\u0434\u0430",
            "latitude": 53.88333,
            "longitude": 25.29972,
        }

    async def fake_fetch_forecast(*, latitude, longitude, forecast_days):
        return {
            "current": {
                "temperature_2m": 18.0,
                "apparent_temperature": 17.0,
                "wind_speed_10m": 3.0,
                "weather_code": 3,
            },
            "daily": {
                "time": ["2026-06-19"],
                "temperature_2m_max": [21.0],
                "temperature_2m_min": [15.0],
                "weather_code": [3],
            },
        }

    monkeypatch.setattr(module, "_resolve_belarus_city", fake_resolve_city)
    monkeypatch.setattr(module, "_fetch_weather_forecast", fake_fetch_forecast)

    result = asyncio.run(
        module.get_weather(city="\u041b\u0456\u0434\u0437\u0435", forecast_days=1)
    )

    assert captured["city_query"] == "\u041b\u0456\u0434\u0430"
    assert "\u0443 \u041b\u0456\u0434\u0437\u0435" in result.text
    assert (
        "\u041f\u0440\u0430\u0433\u043d\u043e\u0437 \u0434\u043b\u044f \u041b\u0456\u0434\u044b"
        in result.text
    )


def test_resolve_belarus_city_tries_generated_city_query_candidates(monkeypatch):
    module = _load_module()
    calls = []

    async def fake_fetch_json(url, *, params):
        calls.append(params["name"])
        if params["name"] == "\u0413\u0440\u043e\u0434\u043d\u0430":
            return {
                "results": [
                    {
                        "name": "\u0413\u0440\u043e\u0434\u043d\u0430",
                        "country_code": "BY",
                        "latitude": 53.6884,
                        "longitude": 23.8258,
                    }
                ]
            }
        return {"results": []}

    monkeypatch.setattr(module, "_fetch_json", fake_fetch_json)

    result = asyncio.run(
        module._resolve_belarus_city("\u0413\u0440\u043e\u0434\u043d\u0435")
    )

    assert calls[:2] == [
        "\u0413\u0440\u043e\u0434\u043d\u0435",
        "\u0413\u0440\u043e\u0434\u043d\u0430",
    ]
    assert result["name"] == "\u0413\u0440\u043e\u0434\u043d\u0430"


def test_get_weather_formats_grodno_city_name(monkeypatch):
    module = _load_module()

    async def fake_resolve_city(city_query):
        return {
            "name": "\u0413\u0440\u043e\u0434\u043d\u0430",
            "latitude": 53.6884,
            "longitude": 23.8258,
        }

    async def fake_fetch_forecast(*, latitude, longitude, forecast_days):
        return {
            "current": {
                "temperature_2m": 20.0,
                "apparent_temperature": 19.0,
                "wind_speed_10m": 2.0,
                "weather_code": 1,
            },
            "daily": {
                "time": ["2026-06-19"],
                "temperature_2m_max": [22.0],
                "temperature_2m_min": [14.0],
                "weather_code": [1],
            },
        }

    monkeypatch.setattr(module, "_resolve_belarus_city", fake_resolve_city)
    monkeypatch.setattr(module, "_fetch_weather_forecast", fake_fetch_forecast)

    result = asyncio.run(
        module.get_weather(city="\u0413\u0440\u043e\u0434\u043d\u0435", forecast_days=1)
    )

    assert "\u0443 \u0413\u0440\u043e\u0434\u043d\u0435" in result.text
    assert (
        "\u041f\u0440\u0430\u0433\u043d\u043e\u0437 \u0434\u043b\u044f \u0413\u0440\u043e\u0434\u043d\u0430"
        in result.text
    )


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


def test_get_weather_formats_belarusian_forecast_text(monkeypatch):
    module = _load_module()

    async def fake_resolve_city(city_query):
        return {"name": "Minsk", "latitude": 53.9, "longitude": 27.56}

    async def fake_fetch_forecast(*, latitude, longitude, forecast_days):
        return {
            "current": {
                "temperature_2m": 6.0,
                "apparent_temperature": 3.0,
                "wind_speed_10m": 4.0,
                "weather_code": 61,
            },
            "daily": {
                "time": ["2026-03-18", "2026-03-19"],
                "temperature_2m_max": [8.0, 9.0],
                "temperature_2m_min": [2.0, 3.0],
                "weather_code": [61, 3],
            },
        }

    monkeypatch.setattr(module, "_resolve_belarus_city", fake_resolve_city)
    monkeypatch.setattr(module, "_fetch_weather_forecast", fake_fetch_forecast)

    result = asyncio.run(module.get_weather(city="Minsk", forecast_days=2))

    assert "адчуваецца як 3°" in result.text
    assert "вецер 4 м/с" in result.text
    assert "дождж" in result.text
    assert "Прагноз для Мінска" in result.text
