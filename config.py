import os
from dotenv import load_dotenv
from google import genai

# Load environment variables from .env file
load_dotenv()

# Handle API keys. Vertex AI in express mode uses GOOGLE_API_KEY.
# Keep GEMINI_API_KEY as a backward-compatible input alias, but normalize the
# process environment to GOOGLE_API_KEY-only so ADK chooses Vertex express mode.
_legacy_gemini_api_key = os.getenv("GEMINI_API_KEY")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY") or _legacy_gemini_api_key
GEMINI_API_KEY = GOOGLE_API_KEY

_HAS_SERVICE_ACCOUNT = bool(
    os.getenv("GOOGLE_APPLICATION_CREDENTIALS") and os.getenv("GOOGLE_CLOUD_PROJECT")
)

if GOOGLE_API_KEY:
    os.environ["GOOGLE_API_KEY"] = GOOGLE_API_KEY
    os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "true"
    os.environ.pop("GEMINI_API_KEY", None)
    # Wipe Vertex project/location only when we explicitly want express mode
    # (no service-account creds present). Otherwise the standard Vertex flow
    # needs project + location alongside ADC.
    if not _HAS_SERVICE_ACCOUNT:
        os.environ.pop("GOOGLE_CLOUD_PROJECT", None)
        os.environ.pop("GOOGLE_CLOUD_LOCATION", None)

if not GOOGLE_API_KEY:
    print("WARNING: GOOGLE_API_KEY not found in environment variables or .env file.")


def create_genai_client(*, api_key: str | None = None, location: str | None = None):
    creds_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    project = os.getenv("GOOGLE_CLOUD_PROJECT")
    resolved_location = location or os.getenv("GOOGLE_CLOUD_LOCATION", "global")
    if creds_path and project:
        return genai.Client(vertexai=True, project=project, location=resolved_location)
    resolved_api_key = api_key or GOOGLE_API_KEY or GEMINI_API_KEY
    if not resolved_api_key:
        raise RuntimeError("GOOGLE_API_KEY env var not set")
    return genai.Client(vertexai=True, api_key=resolved_api_key, location=resolved_location)


# Voice / Teacher pipelines stay pinned to a stable region (e.g. "eu") regardless
# of the chat router region in GOOGLE_CLOUD_LOCATION.
VOICE_GOOGLE_CLOUD_LOCATION = os.getenv("VOICE_GOOGLE_CLOUD_LOCATION")
    
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
ADK_MODEL = os.getenv("ADK_MODEL", "gemini-2.5-flash")
ROUTER_AGENT_MODEL = os.getenv("ROUTER_AGENT_MODEL", ADK_MODEL)
SEARCH_AGENT_MODEL = os.getenv("SEARCH_AGENT_MODEL", ADK_MODEL)
MEME_AGENT_MODEL = os.getenv("MEME_AGENT_MODEL", ADK_MODEL)

# TTS Configuration
TTS_MODE = os.getenv("TTS_MODE", "local").lower()  # "local" or "api"
HF_TOKEN = os.getenv("HF_TOKEN", "") or os.getenv("HUGGINGFACE_API_TOKEN", "")

# TTS Streaming — Server-side buffers
TTS_INITIAL_BUFFER_S = 0.06         # сек, першы чанк (меньш = хутчэй пачатак гуку)
TTS_MIN_BUFFER_S = 0.08             # сек, наступныя чанкі (меньш = менш затрымак паміж чанкамі)
TTS_FIRST_SEGMENT_LIMIT = 40        # сімвалаў у першым тэкставым сегменце (першы сказ для хуткага старту)
TTS_TEMPERATURE = 0.15
TTS_TOP_K = 5
TTS_TOP_P = 0.75

# TTS Streaming — Client-side playback
TTS_SCRIPT_BUFFER_SIZE = 1024       # ScriptProcessor buffer (samples, 1024 = ~42ms at 24kHz)
TTS_PLAYBACK_MIN_BUFFER_MS = 0      # 0 = пачынаць адразу (Colab-style, без pre-buffering)
TTS_PLAYBACK_EMPTY_GRACE_MS = 120   # grace period калі чарга пустая (мс); меньш = хутчэй рэакцыя на канец

# Voice Agent Configuration
SIMPLE_VOICE_AGENT = os.getenv("SIMPLE_VOICE_AGENT", "True").lower() == "true"
SIMPLE_VOICE_SYSTEM_PROMPT = os.getenv("SIMPLE_VOICE_SYSTEM_PROMPT", """Ты — Юзік, беларускамоўны галасавы асістэнт. Адказвай прыемна і па сутнасці, каб добра гучала ўголас, недоўгі адказ у 1-3 сказы.
Правілы:
- Пішы толькі па-беларуску.
- Калі ўваход — аўдыяфайл з голасам: не выдавай транскрыпцыю і не дадавай часовыя меткі. Адразу адказвай на змест сказанага, як быццам атрымаў тэкставы запыт.
- Лічбы і скарачэнні пішы словамі. Не выкарыстоўвай “і г.д.”, “км”, “°C” і падобнае — расшыфроўвай.
- Калі не хапае даных — удакладняй у карыстальніка.""")
SIMPLE_VOICE_MODEL = os.getenv("SIMPLE_VOICE_MODEL", "gemini-3.1-flash-lite-preview") # gemini-2.5-flash-lite
IMAGE_GENERATION_MODEL = os.getenv("IMAGE_GENERATION_MODEL")
SIMPLE_VOICE_DEBUG_TIMESTAMPS = os.getenv("SIMPLE_VOICE_DEBUG_TIMESTAMPS", "True").lower() == "true"

# Local ASR Configuration
LOCAL_ASR = os.getenv("LOCAL_ASR", "True").lower() == "true"
LOCAL_ASR_MODEL = os.getenv("LOCAL_ASR_MODEL", "nvidia/stt_be_fastconformer_hybrid_large_pc")

# Remote ASR side-channel (used when LOCAL_ASR=False) — cheaper/faster Gemini variant
# runs in parallel with the main multimodal reply call to surface a transcript for the UI
# and persist it in voice history.
REMOTE_ASR_MODEL = os.getenv("REMOTE_ASR_MODEL", os.getenv("SIMPLE_VOICE_MODEL", "gemini-2.5-flash-lite"))

# Dialogue log
DIALOGUE_LOG_PATH = os.getenv("DIALOGUE_LOG_PATH", "dialogues.txt")

# Default Bot Replies
DEFAULT_NO_ANSWER = "🌀 Прабачце, не атрымалася сфарміраваць адказ. Паспрабуйце яшчэ раз."
DEFAULT_ERROR = "Упс, Юзік страціў гузік ці інакш адбылася памылка! Паспрабуйце пазней."

SUPABASE_REQUIRED_ENV_VARS = (
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_JWT_ISSUER",
    "SUPABASE_JWT_AUDIENCE",
    "SUPABASE_UPLOAD_BUCKET",
    "SUPABASE_ARTIFACT_BUCKET",
    "SUPABASE_WEB_CALLBACK_DEV",
    "SUPABASE_WEB_CALLBACK_PROD",
    "SUPABASE_MOBILE_CALLBACK_DEV",
    "SUPABASE_MOBILE_CALLBACK_PROD",
)


def has_supabase_config() -> bool:
    return all(os.getenv(name) for name in SUPABASE_REQUIRED_ENV_VARS)


def load_supabase_settings():
    from services.supabase.config import load_supabase_settings as _load_supabase_settings

    return _load_supabase_settings()
