from __future__ import annotations

from datetime import datetime
from typing import Any

import aiohttp
from google.adk.tools import FunctionTool
from google.genai import types


GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
WEATHER_CODE_LABELS = {
    0: "ясна",
    1: "пераважна ясна",
    2: "пераменная воблачнасць",
    3: "пахмурна",
}
CITY_NAME_LABELS = {
    "Minsk": ("Мінск", "Мінску"),
    "Минск": ("Мінск", "Мінску"),
    "Мінск": ("Мінск", "Мінску"),
    "Brest": ("Брэст", "Брэсьце"),
    "Брест": ("Брэст", "Брэсьце"),
    "Брэст": ("Брэст", "Брэсьце"),
}


def _format_number(value: Any) -> str:
    if value is None:
        return "няма даных"
    if isinstance(value, float):
        if value.is_integer():
            return str(int(value))
        return f"{value:.1f}".rstrip("0").rstrip(".")
    return str(value)


def _normalize_city_name(city_name: str) -> tuple[str, str]:
    if city_name in CITY_NAME_LABELS:
        return CITY_NAME_LABELS[city_name]
    cleaned = city_name.strip()
    return cleaned, cleaned


def _weather_label(code: Any) -> str:
    return WEATHER_CODE_LABELS.get(code, "надвор'е без удакладнення")


def _day_label(value: str) -> str:
    try:
        return datetime.fromisoformat(value).strftime("%d.%m")
    except ValueError:
        return value


def _format_weather_reply(city_name: str, forecast: dict[str, Any], forecast_days: int) -> str:
    display_name, locative_name = _normalize_city_name(city_name)
    current = forecast.get("current") or {}
    daily = forecast.get("daily") or {}

    current_text = (
        f"Зараз у {locative_name} {_weather_label(current.get('weather_code'))}, "
        f"{_format_number(current.get('temperature_2m'))}°"
    )
    if current.get("apparent_temperature") is not None:
        current_text += f", адчуваецца як {_format_number(current.get('apparent_temperature'))}°"
    if current.get("wind_speed_10m") is not None:
        current_text += f", вецер {_format_number(current.get('wind_speed_10m'))} м/с"
    current_text += "."

    forecast_parts: list[str] = []
    times = daily.get("time") or []
    max_values = daily.get("temperature_2m_max") or []
    min_values = daily.get("temperature_2m_min") or []
    weather_codes = daily.get("weather_code") or []
    for index in range(min(forecast_days, len(times))):
        max_value = max_values[index] if index < len(max_values) else None
        min_value = min_values[index] if index < len(min_values) else None
        weather_code = weather_codes[index] if index < len(weather_codes) else None
        forecast_parts.append(
            (
                f"{_day_label(times[index])}: "
                f"{_format_number(min_value)}..{_format_number(max_value)}°, "
                f"{_weather_label(weather_code)}"
            )
        )

    if not forecast_parts:
        return current_text

    return f"{current_text} Прагноз для {display_name} на найбліжэйшыя {forecast_days} дні: " + "; ".join(forecast_parts) + "."


async def _fetch_json(url: str, *, params: dict[str, Any]) -> dict[str, Any]:
    timeout = aiohttp.ClientTimeout(total=30)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(url, params=params) as response:
            if response.status >= 400:
                raise RuntimeError(f"Weather API error {response.status}")
            return await response.json()


async def _resolve_belarus_city(city_query: str) -> dict[str, Any] | None:
    data = await _fetch_json(
        GEOCODING_URL,
        params={
            "name": city_query,
            "count": 10,
            "language": "be",
            "format": "json",
        },
    )
    for item in data.get("results") or []:
        if item.get("country_code") != "BY":
            continue
        return {
            "name": item.get("name") or city_query,
            "latitude": item["latitude"],
            "longitude": item["longitude"],
        }
    return None


async def _fetch_weather_forecast(
    *,
    latitude: float,
    longitude: float,
    forecast_days: int,
) -> dict[str, Any]:
    return await _fetch_json(
        FORECAST_URL,
        params={
            "latitude": latitude,
            "longitude": longitude,
            "forecast_days": forecast_days,
            "current": "temperature_2m,apparent_temperature,wind_speed_10m,weather_code",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min",
            "timezone": "auto",
        },
    )


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


weather_tool = FunctionTool(get_weather)

__all__ = ["weather_tool"]
