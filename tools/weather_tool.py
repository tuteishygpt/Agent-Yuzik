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
    61: "дождж",
}
CITY_NAME_LABELS = {
    "\u041b\u0456\u0434\u0430": (
        "\u041b\u0456\u0434\u0430",
        "\u041b\u0456\u0434\u0437\u0435",
        "\u041b\u0456\u0434\u044b",
    ),
    "\u041b\u0438\u0434\u0430": (
        "\u041b\u0456\u0434\u0430",
        "\u041b\u0456\u0434\u0437\u0435",
        "\u041b\u0456\u0434\u044b",
    ),
    "Lida": (
        "\u041b\u0456\u0434\u0430",
        "\u041b\u0456\u0434\u0437\u0435",
        "\u041b\u0456\u0434\u044b",
    ),
    "\u0413\u0440\u043e\u0434\u043d\u0430": (
        "\u0413\u0440\u043e\u0434\u043d\u0430",
        "\u0413\u0440\u043e\u0434\u043d\u0435",
        "\u0413\u0440\u043e\u0434\u043d\u0430",
    ),
    "Grodno": (
        "\u0413\u0440\u043e\u0434\u043d\u0430",
        "\u0413\u0440\u043e\u0434\u043d\u0435",
        "\u0413\u0440\u043e\u0434\u043d\u0430",
    ),
    "\u0413\u043e\u043c\u0435\u043b\u044c": (
        "\u0413\u043e\u043c\u0435\u043b\u044c",
        "\u0413\u043e\u043c\u0435\u043b\u0456",
        "\u0413\u043e\u043c\u0435\u043b\u044f",
    ),
    "\u041c\u0430\u0433\u0456\u043b\u0451\u045e": (
        "\u041c\u0430\u0433\u0456\u043b\u0451\u045e",
        "\u041c\u0430\u0433\u0456\u043b\u0451\u0432\u0435",
        "\u041c\u0430\u0433\u0456\u043b\u0451\u0432\u0430",
    ),
    "\u0412\u0456\u0446\u0435\u0431\u0441\u043a": (
        "\u0412\u0456\u0446\u0435\u0431\u0441\u043a",
        "\u0412\u0456\u0446\u0435\u0431\u0441\u043a\u0443",
        "\u0412\u0456\u0446\u0435\u0431\u0441\u043a\u0430",
    ),
    "\u041f\u043e\u043b\u0430\u0446\u043a": (
        "\u041f\u043e\u043b\u0430\u0446\u043a",
        "\u041f\u043e\u043b\u0430\u0446\u043a\u0443",
        "\u041f\u043e\u043b\u0430\u0446\u043a\u0430",
    ),
    "\u041f\u0456\u043d\u0441\u043a": (
        "\u041f\u0456\u043d\u0441\u043a",
        "\u041f\u0456\u043d\u0441\u043a\u0443",
        "\u041f\u0456\u043d\u0441\u043a\u0430",
    ),
    "\u0411\u0430\u0431\u0440\u0443\u0439\u0441\u043a": (
        "\u0411\u0430\u0431\u0440\u0443\u0439\u0441\u043a",
        "\u0411\u0430\u0431\u0440\u0443\u0439\u0441\u043a\u0443",
        "\u0411\u0430\u0431\u0440\u0443\u0439\u0441\u043a\u0430",
    ),
    "\u0411\u0430\u0440\u044b\u0441\u0430\u045e": (
        "\u0411\u0430\u0440\u044b\u0441\u0430\u045e",
        "\u0411\u0430\u0440\u044b\u0441\u0430\u0432\u0435",
        "\u0411\u0430\u0440\u044b\u0441\u0430\u0432\u0430",
    ),
    "\u041e\u0440\u0448\u0430": (
        "\u041e\u0440\u0448\u0430",
        "\u041e\u0440\u0448\u044b",
        "\u041e\u0440\u0448\u044b",
    ),
    "Minsk": ("Мінск", "Мінску", "Мінска"),
    "Минск": ("Мінск", "Мінску", "Мінска"),
    "Мінск": ("Мінск", "Мінску", "Мінска"),
    "Brest": ("Брэст", "Брэсьце", "Брэста"),
    "Брест": ("Брэст", "Брэсьце", "Брэста"),
    "Брэст": ("Брэст", "Брэсьце", "Брэста"),
}
CITY_QUERY_ALIASES = {
    "\u043b\u0456\u0434\u0437\u0435": "\u041b\u0456\u0434\u0430",
    "\u043b\u0456\u0434\u044b": "\u041b\u0456\u0434\u0430",
    "\u043b\u0438\u0434\u0435": "\u041b\u0438\u0434\u0430",
    "\u043b\u0438\u0434\u044b": "\u041b\u0438\u0434\u0430",
}
CITY_DECLENSION_SUFFIXES = (
    ("\u0446\u043a\u0443", "\u0446\u043a"),
    ("\u0441\u043a\u0443", "\u0441\u043a"),
    ("\u0434\u0437\u0435", "\u0434\u0430"),
    ("\u0451\u0432\u0435", "\u0451\u045e"),
    ("\u0430\u0432\u0435", "\u0430\u045e"),
    ("\u0435\u0432\u0435", "\u0435\u045e"),
    ("\u043e\u0432\u0435", "\u043e\u0432"),
    ("\u043d\u0435", "\u043d\u0430"),
    ("\u043d\u0435", "\u043d"),
    ("\u043b\u0456", "\u043b\u044c"),
    ("\u0436\u044b", "\u0436"),
    ("\u0440\u044b", "\u0440"),
    ("\u0448\u044b", "\u0448\u0430"),
)


def _format_number(value: Any) -> str:
    if value is None:
        return "няма даных"
    if isinstance(value, float):
        if value.is_integer():
            return str(int(value))
        return f"{value:.1f}".rstrip("0").rstrip(".")
    return str(value)


def _normalize_city_name(city_name: str) -> tuple[str, str, str]:
    if city_name in CITY_NAME_LABELS:
        return CITY_NAME_LABELS[city_name]
    cleaned = city_name.strip()
    return cleaned, cleaned, cleaned


def _normalize_city_query(city_name: str) -> str:
    cleaned = city_name.strip()
    return CITY_QUERY_ALIASES.get(cleaned.casefold(), cleaned)


def _replace_city_suffix(city_name: str, suffix: str, replacement: str) -> str | None:
    if not city_name.casefold().endswith(suffix):
        return None
    return city_name[: -len(suffix)] + replacement


def _city_query_candidates(city_name: str) -> list[str]:
    primary = _normalize_city_query(city_name)
    candidates = [primary] if primary else []
    for suffix, replacement in CITY_DECLENSION_SUFFIXES:
        candidate = _replace_city_suffix(primary, suffix, replacement)
        if candidate and candidate not in candidates:
            candidates.append(candidate)
    return candidates


def _weather_label(code: Any) -> str:
    return WEATHER_CODE_LABELS.get(code, "надвор'е без удакладнення")


def _day_label(value: str) -> str:
    try:
        return datetime.fromisoformat(value).strftime("%d.%m")
    except ValueError:
        return value


def _format_weather_reply(city_name: str, forecast: dict[str, Any], forecast_days: int) -> str:
    display_name, locative_name, genitive_name = _normalize_city_name(city_name)
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

    return (
        f"{current_text} Прагноз для {genitive_name} на найбліжэйшыя {forecast_days} дні: "
        + "; ".join(forecast_parts)
        + "."
    )


async def _fetch_json(url: str, *, params: dict[str, Any]) -> dict[str, Any]:
    timeout = aiohttp.ClientTimeout(total=30)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(url, params=params) as response:
            if response.status >= 400:
                raise RuntimeError(f"Weather API error {response.status}")
            return await response.json()


async def _resolve_belarus_city(city_query: str) -> dict[str, Any] | None:
    for query in _city_query_candidates(city_query):
        data = await _fetch_json(
            GEOCODING_URL,
            params={
                "name": query,
                "count": 10,
                "language": "be",
                "format": "json",
            },
        )
        for item in data.get("results") or []:
            if item.get("country_code") != "BY":
                continue
            return {
                "name": item.get("name") or query,
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


async def get_weather(city: str = "", forecast_days: int = 1) -> types.Part:
    city_query = _normalize_city_query(city or "") or "Minsk"
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


class WeatherTool(FunctionTool):
    """ADK tool wrapper with a manual declaration compatible with Vertex AI."""

    def _get_declaration(self) -> types.FunctionDeclaration:
        return types.FunctionDeclaration(
            name=self.name,
            description=self.description,
            parameters=types.Schema(
                type=types.Type.OBJECT,
                properties={
                    "city": types.Schema(
                        type=types.Type.STRING,
                        description="Belarusian city name. Use Minsk when omitted.",
                    ),
                    "forecast_days": types.Schema(
                        type=types.Type.INTEGER,
                        description="Number of forecast days from 1 to 3.",
                    ),
                },
            ),
        )


weather_tool = WeatherTool(get_weather)

__all__ = ["weather_tool"]
