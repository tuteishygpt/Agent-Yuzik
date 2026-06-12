import json

import config
from google.adk.agents import LlmAgent
from google.adk.models.llm_request import LlmRequest
from google.adk.tools import BaseTool, ToolContext, agent_tool

from google_search_agent.agent import search_agent
from meme_generator_agent.agent import meme_agent
from tools.minsk_datetime_tool import minsk_datetime_tool
from tools.verbum_tool import verbum_tool
from tools.weather_tool import weather_tool


MINSK_TIME_INSTRUCTION = (
    "Use Europe/Minsk as the canonical timezone when Minsk time mode is enabled. "
    "Whenever the answer depends on the current date or time, including now, today, "
    "tomorrow, yesterday, current weekday, or schedule calculations relative to the "
    "present, call `get_minsk_datetime` (minsk_datetime_tool) immediately before answering. "
    "Do not rely on stale time information from earlier in the conversation."
)


def _previous_context_payload(state) -> dict[str, str]:
    payload = {}
    previous_text = state.get("temp:turn_previous_text")
    previous_summary = state.get("temp:turn_previous_summary")
    if isinstance(previous_text, str) and previous_text.strip():
        payload["previous_text"] = previous_text.strip()
    if isinstance(previous_summary, str) and previous_summary.strip():
        payload["previous_summary"] = previous_summary.strip()
    return payload


def _append_previous_context_instruction(callback_context, llm_request: LlmRequest) -> None:
    payload = _previous_context_payload(callback_context.state)
    if not payload:
        return
    llm_request.append_instructions(
        [
            (
                "Workflow context is available as this JSON object: "
                f"{json.dumps(payload, ensure_ascii=False)}. Use previous_text or "
                "previous_summary only when the latest user request clearly refers "
                "to prior assistant output, for example with it, this, that, above, "
                "previous, last, яе, яго, гэта, or апошні. If the latest request is "
                "self-contained, ignore this context."
            )
        ]
    )


def enable_minsk_time_mode(callback_context, llm_request: LlmRequest):
    if callback_context.state.get("temp:minsk_time_enabled"):
        llm_request.append_instructions([MINSK_TIME_INSTRUCTION])

    _append_previous_context_instruction(callback_context, llm_request)

    return None


def guard_one_call(tool: BaseTool, args: dict, tool_context: ToolContext, **kwargs) -> dict | None:
    return None


router_agent = LlmAgent(
    name="router_agent",
    model=config.create_adk_model(config.ROUTER_AGENT_MODEL),
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
