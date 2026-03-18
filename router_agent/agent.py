import re

from google.adk.agents import LlmAgent
from google.adk.models.llm_request import LlmRequest
from google.adk.tools import BaseTool, ToolContext, agent_tool
from google.genai import types

from google_search_agent.agent import search_agent
from meme_generator_agent.agent import meme_agent
from tools.gemini_image_generator import generate_image_tool
from tools.minsk_datetime_tool import minsk_datetime_tool
from tools.weather_tool import weather_tool
from tools.text_to_speech_tool import synthesize_speech_tool


TIME_RELATED_PATTERN = re.compile(
    r"(?:\b(?:time|date|now|today|tomorrow|yesterday|current|weekday|timezone)\b"
    r"|час\w*|дата\w*|сёння\w*|сення\w*|заўтра\w*|заутра\w*|учора\w*|цяпер\w*"
    r"|время\w*|сегодня\w*|завтра\w*|вчера\w*|сейчас\w*)",
    re.IGNORECASE,
)

MINSK_TIME_INSTRUCTION = (
    "Use Europe/Minsk as the canonical timezone when Minsk time mode is enabled. "
    "Whenever the answer depends on the current date or time, including now, today, "
    "tomorrow, yesterday, current weekday, or schedule calculations relative to the "
    "present, call `minsk_datetime_tool` immediately before answering. "
    "Do not rely on stale time information from earlier in the conversation."
)


def _latest_user_text(llm_request: LlmRequest) -> str:
    for content in reversed(llm_request.contents or []):
        if getattr(content, "role", None) != "user":
            continue
        text_parts = [part.text for part in (content.parts or []) if getattr(part, "text", None)]
        if text_parts:
            return "\n".join(text_parts)
    return ""


def enable_minsk_time_mode(callback_context, llm_request: LlmRequest):
    if llm_request.config is None:
        llm_request.config = types.GenerateContentConfig()

    if TIME_RELATED_PATTERN.search(_latest_user_text(llm_request)):
        callback_context.state["user:timezone"] = "Europe/Minsk"
        callback_context.state["user:minsk_time_enabled"] = True

    if callback_context.state.get("user:minsk_time_enabled"):
        llm_request.append_instructions([MINSK_TIME_INSTRUCTION])

    return None


def guard_one_call(tool: BaseTool, args: dict, tool_context: ToolContext, **kwargs) -> dict | None:
    key = "temp:tts_called"
    if tool.name != getattr(synthesize_speech_tool, "name", "synthesize_speech_tool"):
        return None
    if tool_context.state.get(key):
        return {
            "status": "error",
            "error_message": f"{tool.name} ужо выкарыстоўваўся ў гэтым запыце.",
        }
    tool_context.state[key] = True
    return None


router_agent = LlmAgent(
    name="router_agent",
    model="gemini-flash-latest",
    description="Беларускі агент Юзік — твой беларускамоўны сябар.",
    instruction=r"""
        Ты — беларускі агент **Юзік**.
        • Размаўляй з карыстальнікам выключна па-беларуску.
        • Калі на ўваходзе ёсць файл, уважліва вывучы яго змест. Ты можаш апісваць малюнкі, рабіць кароткі пераказ тэкставых дакументаў, транскрыбаваць аўдыё і адказваць на пытанні, звязаныя са зместам файла.
        • Калі патрэбны пошук у інтэрнэце — выклікай `search_agent`.
        • Калі трэба ведаць актуальныя дату ці час па Мінску — выклікай `minsk_datetime_tool`.
        • Калі пытаюцца пра надвор'е або прагноз — выклікай `weather_tool`. Калі горад не названы, выкарыстоўвай Мінск.
        • Калі трэба агучыць тэкст — выклікай `synthesize_speech_tool`.
        • Калі трэба стварыць малюнак — перакладзі запыт на ангельскую мову і выклікай `generate_image_tool`.
        • Калі просяць стварыць мем — выклікай `meme_agent`.
        • Не выкарыстоўвай іншых суб-агентаў і не генеруй кодаў, калі гэта не патрэбна.
    """,
    tools=[
        agent_tool.AgentTool(agent=search_agent),
        agent_tool.AgentTool(agent=meme_agent),
        minsk_datetime_tool,
        weather_tool,
        synthesize_speech_tool,
        generate_image_tool,
    ],
    before_model_callback=enable_minsk_time_mode,
    before_tool_callback=guard_one_call,
)
