import config
from google.adk.agents import LlmAgent


def _load_google_search_tool():
    try:
        from google.adk.tools import google_search
    except ImportError:
        from google.adk.tools.google_search_tool import GoogleSearchTool

        return GoogleSearchTool()
    return google_search


google_search_tool = _load_google_search_tool()

search_agent = LlmAgent(
    name="search_agent",
    model=config.create_adk_model(config.SEARCH_AGENT_MODEL),
    description="Агент-пошукавік Google Search.",
    instruction="""
        Ты спецыялізуешся на пошуку ў інтэрнэце.
        • Калі атрымліваеш запыт — адразу выклікай google_search.
        • Вынікі сціслай па-беларуску.
    """,
    tools=[google_search_tool],
)
