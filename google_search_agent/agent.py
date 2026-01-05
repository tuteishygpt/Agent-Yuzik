from google.adk.agents import LlmAgent
from google.adk.tools import google_search

search_agent = LlmAgent(
    name="search_agent",
    model="gemini-2.0-flash",              # ↟ мадэль без preview
    description="Агент-пошукавік Google Search.",
    instruction="""
        Ты спецыялізуешся на пошуку ў інтэрнэце.
        • Калі атрымліваеш запыт — адразу выклікай google_search.
        • Вынікі сціслай па-беларуску.
    """,
    tools=[google_search],                 # 1 built-in tool
)
