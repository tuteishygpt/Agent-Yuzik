import re

import config
from google.adk.agents import LlmAgent
from google.adk.models.llm_request import LlmRequest
from google.adk.tools import BaseTool, ToolContext, agent_tool
from google.genai import types

from google_search_agent.agent import search_agent
from meme_generator_agent.agent import meme_agent
from tools.minsk_datetime_tool import minsk_datetime_tool
from tools.verbum_tool import verbum_tool
from tools.weather_tool import weather_tool


TIME_RELATED_PATTERN = re.compile(
    r"(?:\b(?:time|date|now|today|tomorrow|yesterday|current|weekday|timezone)\b"
    r"|час\w*|дата\w*|сёння\w*|заўтра\w*|учора\w*|цяпер\w*"
    r"|время\w*|сегодня\w*|завтра\w*|вчера\w*|сейчас\w*)",
    re.IGNORECASE,
)

TTS_REQUESTED_PATTERN = re.compile(
    r"(?:агуч\w*|прачыта\w*\s+уголас|прачыта\w*\s+услых|зрабі\s+аўдыя|зрабі\s+голас"
    r"|вымаў\w*|скажы\s+уголас|скажы\s+услых|озвуч\w*|прочита\w*\s+вслух"
    r"|read\s+(?:aloud|out\s+loud)|say\s+(?:it|this)\s+(?:out\s+)?loud|speak\s+(?:it|this))",
    re.IGNORECASE,
)

IMAGE_REQUESTED_PATTERN = re.compile(
    r"(?:намалю\w*|нарысу\w*|згенеру\w*\s+(?:малюнак|выяв\w*|карцінк\w*|фота)"
    r"|стварыць?\s+(?:малюнак|выяв\w*|карцінк\w*)|зрабі\s+(?:малюнак|выяв\w*|карцінк\w*|фота)"
    r"|нарисуй|сгенерируй\s+(?:изображение|картинк\w*|фото)|создай\s+(?:изображение|картинк\w*)"
    r"|draw|generate\s+(?:an?\s+)?(?:image|picture|photo)|create\s+(?:an?\s+)?(?:image|picture))",
    re.IGNORECASE,
)

CREATION_CANCEL_PATTERN = re.compile(
    r"(?:адмен\w*|забудзь|не\s+трэба|скасу\w*|стоп"
    r"|отмен\w*|забудь|не\s+нужно|стой"
    r"|cancel|nevermind|never\s+mind|forget\s+it|stop)",
    re.IGNORECASE,
)

MINSK_TIME_INSTRUCTION = (
    "Use Europe/Minsk as the canonical timezone when Minsk time mode is enabled. "
    "Whenever the answer depends on the current date or time, including now, today, "
    "tomorrow, yesterday, current weekday, or schedule calculations relative to the "
    "present, call `get_minsk_datetime` (minsk_datetime_tool) immediately before answering. "
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

    user_text = _latest_user_text(llm_request)

    if TIME_RELATED_PATTERN.search(user_text):
        callback_context.state["user:timezone"] = "Europe/Minsk"
        callback_context.state["user:minsk_time_enabled"] = True

    if callback_context.state.get("user:minsk_time_enabled"):
        llm_request.append_instructions([MINSK_TIME_INSTRUCTION])

    cancelled = bool(CREATION_CANCEL_PATTERN.search(user_text))

    tts_in_text = bool(TTS_REQUESTED_PATTERN.search(user_text))
    if cancelled:
        callback_context.state["user:tts_sticky"] = False
    elif tts_in_text:
        callback_context.state["user:tts_sticky"] = True
    callback_context.state["temp:tts_requested"] = (
        tts_in_text or callback_context.state.get("user:tts_sticky", False)
    )

    image_in_text = bool(IMAGE_REQUESTED_PATTERN.search(user_text))
    if cancelled:
        callback_context.state["user:image_sticky"] = False
    elif image_in_text:
        callback_context.state["user:image_sticky"] = True
    callback_context.state["temp:image_requested"] = (
        image_in_text or callback_context.state.get("user:image_sticky", False)
    )

    return None


def guard_one_call(tool: BaseTool, args: dict, tool_context: ToolContext, **kwargs) -> dict | None:
    return None


router_agent = LlmAgent(
    name="router_agent",
    model=config.ROUTER_AGENT_MODEL,
    description="Беларускі агент Юзік — твой беларускамоўны сябар.",
    instruction=(r"""
        Ты — беларускі агент **Юзік**.
        • Размаўляй з карыстальнікамі выключна па-беларуску.
        • Калі на ўваходзе ёсць файл, уважліва вывучы яго змест. Ты можаш апісваць малюнкі, рабіць кароткі пераказ тэкставых дакументаў, транскрыбаваць аўдыё і адказваць на пытанні, звязаныя са зместам файла.
        • Калі патрэбны пошук у інтэрнэце — выклікай `search_agent`.
        • Калі пытаюцца пра слова ў слоўніку, яго значэнне, граматыку, формы або правапіс у Verbum — выклікай `lookup_verbum` (`verbum_tool`).
        • Калі `lookup_verbum` нічога не знайшоў у Verbum, паведам пра гэта і не пераходзь да `search_agent`.
        • Калі трэба ведаць актуальныя дату ці час па Мінску — выклікай `get_minsk_datetime`.
        • Калі пытаюцца пра надвор'е або прагноз — выклікай `get_weather` (`weather_tool`). Калі горад не названы, выкарыстоўвай Мінск.
        • Калі карыстальнік відавочна просіць агучыць, прачытаць уголас або зрабіць аўдыя/голас з тэксту (напрыклад: «агучы...», «прачытай уголас...», «зрабі аўдыя...») — выклікай `synthesize_speech`. Ні ў якім разе не выклікай `synthesize_speech` сам сабою для звычайных тэкставых адказаў, перакладаў, тлумачэнняў або пошукавых вынікаў.
        • Калі карыстальнік просіць намаляваць, згенераваць або стварыць малюнак (напрыклад: «намалюй...», «зрабі карцінку...», «згенеруй выяву...») — выклікай `generate_image`, перадаўшы prompt у перакладзе на ангельскую мову. Ні ў якім разе не выклікай `generate_image` для запытаў пераклада тэксту, тлумачэння, пошуку або іншых тэкставых задач.
        • Калі просяць стварыць мем — выклікай `meme_agent`.
        • Не выкарыстоўвай іншых суб-агентаў і не генеруй кодаў, калі гэта не патрэбна.
    """
    .replace("выклікай `synthesize_speech`", "вярні тэкставы адказ")
    .replace("не выклікай `synthesize_speech`", "не чакай, што TTS зробіць router_agent")
    .replace("выклікай `generate_image`", "дазволь workflow апрацаваць image route")
    .replace("не выклікай `generate_image`", "не чакай, што image route зробіць router_agent")),
    tools=[
        agent_tool.AgentTool(agent=search_agent),
        agent_tool.AgentTool(agent=meme_agent),
        minsk_datetime_tool,
        weather_tool,
        verbum_tool,
    ],
    before_model_callback=enable_minsk_time_mode,
    before_tool_callback=guard_one_call,
)
