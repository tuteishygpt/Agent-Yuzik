from __future__ import annotations

from google.adk.agents import LlmAgent
from google.adk.tools import agent_tool, ToolContext, BaseTool
from tools.text_to_speech_tool import synthesize_speech_tool
from tools.flux_generator import generate_image_tool
from google_search_agent.agent import search_agent  # ← асобны агент з google_search
from meme_generator_agent.agent import meme_agent


# ───────── guard: толькі адзін выклік TTS за user-turn ─────────
def guard_one_call(tool: BaseTool, args: dict, tool_context: ToolContext, **kwargs) -> dict | None:
    key = "temp:tts_called"
    if tool_context.state.get(key):
        return {
            "status": "error",
            "error_message": f"{tool.name} ужо выкарыстоўваўся ў гэтым запыце.",
        }
    tool_context.state[key] = True
    return None  # першы (і адзіны) выклік дазволены

# ───────── галоўны агент Юзік ─────────
router_agent = LlmAgent(
    name="router_agent",
    model="gemini-2.5-flash",           # абноўленая мадэль
    description="Беларускі агент Юзік — твой беларускамоўны сябар.",
    instruction=r"""
        Ты — беларускі агент **Юзік**. 
        • Размаўляй з карыстальнікам выключна па-беларуску.
        • Калі на ўваходзе ёсць файл, уважліва вывучы яго змест. Ты можаш апісваць малюнкі, рабіць кароткі пераказ тэкставых дакументаў, транскрыбаваць аўдыё і адказваць на пытанні, звязаныя са зместам файла.
        • Калі патрэбны пошук у інтэрнэце — выклікай `search_agent`.
        • Калі трэба агучыць тэкст — выклікай `synthesize_speech_tool`.
        • Калі трэба стварыць малюнак — перакладзі запыт на ангельскую мову і выклікай `generate_image_tool`.
        • Калі просяць старыць мем — выклікай `meme_agent`.
        • Не выкарыстоўвай іншых суб-агентаў і не генеруй кодаў, калі гэта не патрэбна.
    """,
    tools=[
        agent_tool.AgentTool(agent=search_agent),  # built-in Google Search абгорнуты
        agent_tool.AgentTool(agent=meme_agent), 
        synthesize_speech_tool,                    # кастамны TTS-інструмент
        generate_image_tool,                       # FLUX image generation tool
    ],
    before_tool_callback=guard_one_call,           # аднаразовы TTS-guard
)