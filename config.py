import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Map GEMINI_API_KEY to GOOGLE_API_KEY if needed (google-genai SDK expects GOOGLE_API_KEY)
if "GEMINI_API_KEY" in os.environ and "GOOGLE_API_KEY" not in os.environ:
    os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]

# Telegram Configuration
TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
WEBHOOK_BASE_URL = os.getenv("WEBHOOK_BASE_URL", "https://archivartaunik-belarus-agent-tst.hf.space")
WEBHOOK_PATH = "telegram-webhook"
WEBHOOK_URL = f"{WEBHOOK_BASE_URL.rstrip('/')}/{WEBHOOK_PATH}"
PORT = int(os.getenv("PORT", 7860))
WEBHOOK_SECRET_TOKEN = os.getenv("WEBHOOK_SECRET_TOKEN")

# Agent Configuration
GEMINI_API_KEY = os.environ["GEMINI_API_KEY"]
AGENT_TIMEOUT = int(os.getenv("AGENT_TIMEOUT", 60))

# Default Bot Replies
DEFAULT_NO_ANSWER = "🌀 Прабачце, не атрымалася сфарміраваць адказ. Паспрабуйце яшчэ раз."
DEFAULT_ERROR = "Упс, адбылася памылка! Паспрабуйце пазней."