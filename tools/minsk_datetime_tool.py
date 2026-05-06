"""ADK tool that returns the current Minsk date and time."""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

from google.adk.tools import FunctionTool
from google.adk.tools.tool_context import ToolContext


MINSK_TIMEZONE = "Europe/Minsk"


def get_minsk_datetime(tool_context: Optional[ToolContext] = None) -> dict[str, str]:
    now = datetime.now(ZoneInfo(MINSK_TIMEZONE))

    if tool_context is not None:
        tool_context.state["user:timezone"] = MINSK_TIMEZONE
        tool_context.state["user:minsk_time_enabled"] = True

    return {
        "timezone": MINSK_TIMEZONE,
        "iso_datetime": now.isoformat(timespec="seconds"),
        "date": now.date().isoformat(),
        "time": now.strftime("%H:%M:%S"),
        "weekday": now.strftime("%A"),
        "utc_offset": now.strftime("%z"),
    }


minsk_datetime_tool = FunctionTool(get_minsk_datetime)

__all__ = ["get_minsk_datetime", "minsk_datetime_tool"]
