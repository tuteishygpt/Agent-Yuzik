import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Handle API keys (ensure both GEMINI_API_KEY and GOOGLE_API_KEY are available if one is set)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

if GEMINI_API_KEY and not GOOGLE_API_KEY:
    os.environ["GOOGLE_API_KEY"] = GEMINI_API_KEY
    GOOGLE_API_KEY = GEMINI_API_KEY
elif GOOGLE_API_KEY and not GEMINI_API_KEY:
    os.environ["GEMINI_API_KEY"] = GOOGLE_API_KEY
    GEMINI_API_KEY = GOOGLE_API_KEY

if not GEMINI_API_KEY:
    # Don't crash immediately, but warn or set a dummy to allow app to start for other features (optional)
    # However, for this agent, it is critical. Let's provide a clear error message.
    print("WARNING: GEMINI_API_KEY or GOOGLE_API_KEY not found in environment variables or .env file.")
    # We allow it to pass as None, but functionality depending on it will fail gracefully or raise errors later.
    
# Telegram Configuration
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
WEBHOOK_BASE_URL = os.getenv("WEBHOOK_BASE_URL", "https://archivartaunik-belarus-agent-tst.hf.space")
WEBHOOK_PATH = "telegram-webhook"
WEBHOOK_URL = f"{WEBHOOK_BASE_URL.rstrip('/')}/{WEBHOOK_PATH}"
PORT = int(os.getenv("PORT", 7860))
WEBHOOK_SECRET_TOKEN = os.getenv("WEBHOOK_SECRET_TOKEN")

# Agent Configuration
# GEMINI_API_KEY is already set above
AGENT_TIMEOUT = int(os.getenv("AGENT_TIMEOUT", 60))

# TTS Configuration
TTS_MODE = os.getenv("TTS_MODE", "local").lower()  # "local" or "api"
HF_TOKEN = os.getenv("HF_TOKEN", "") or os.getenv("HUGGINGFACE_API_TOKEN", "")

# TTS Streaming — Server-side buffers
TTS_INITIAL_BUFFER_S = 0.10         # сек, мінімальны памер першага чанка (павялічана для хуткасці/стабільнасці)
TTS_MIN_BUFFER_S = 0.15             # сек, фіксаваны памер наступных чанкаў (0.15с дазваляе збіраць больш стабільныя чанкі)
TTS_FIRST_SEGMENT_LIMIT = 40        # сімвалаў у першым тэкставым сегменце (першы сказ для хуткага старту)
TTS_TEMPERATURE = 0.15
TTS_TOP_K = 5
TTS_TOP_P = 0.75

# TTS Streaming — Client-side playback (Colab-style: мінімальная затрымка)
TTS_SCRIPT_BUFFER_SIZE = 1024       # ScriptProcessor buffer (samples, 1024 = ~42ms at 24kHz)
TTS_PLAYBACK_MIN_BUFFER_MS = 50     # пачынаць пасля лёгкай буферызацыі для стабільнасці
TTS_PLAYBACK_EMPTY_GRACE_MS = 250   # grace period калі чарга пустая (мс) павялічана каб не абрываць гук

# Voice Agent Configuration
SIMPLE_VOICE_AGENT = os.getenv("SIMPLE_VOICE_AGENT", "True").lower() == "true"
SIMPLE_VOICE_SYSTEM_PROMPT = os.getenv("SIMPLE_VOICE_SYSTEM_PROMPT", """Ты — Юзік, беларускамоўны галасавы асістэнт. Адказвай прыемна і па сутнасці, каб добра гучала ўголас.
Правілы:
- Пішы толькі па-беларуску.
- Калі ўваход — аўдыяфайл з голасам: не выдавай транскрыпцыю і не дадавай часовыя меткі. Адразу адказвай на змест сказанага, як быццам атрымаў тэкставы запыт.
- Лічбы і скарачэнні пішы словамі. Не выкарыстоўвай “і г.д.”, “км”, “°C” і падобнае — расшыфроўвай.
- Калі не хапае даных — удакладняй у карыстальніка.""")
SIMPLE_VOICE_MODEL = os.getenv("SIMPLE_VOICE_MODEL", "gemini-2.5-flash") # gemini-2.5-flash-lite
SIMPLE_VOICE_DEBUG_TIMESTAMPS = os.getenv("SIMPLE_VOICE_DEBUG_TIMESTAMPS", "True").lower() == "true"

# Default Bot Replies
DEFAULT_NO_ANSWER = "🌀 Прабачце, не атрымалася сфарміраваць адказ. Паспрабуйце яшчэ раз."
DEFAULT_ERROR = "Упс, Юзік страціў гузік ці інакш адбылася памылка! Паспрабуйце пазней."