from __future__ import annotations

import logging
import os

from dotenv import load_dotenv

# Загрузка пераменных асяроддзя
load_dotenv()

# Падтрымка старога GEMINI_API_KEY як аліяса да GOOGLE_API_KEY
if "GEMINI_API_KEY" in os.environ and "GOOGLE_API_KEY" not in os.environ:
    os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import config

# ---------------------------------------------------------------------
# Канфігурацыя і Лагаванне -------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s │ %(levelname)s │ %(name)s │ %(message)s",
)
log = logging.getLogger("app")

PORT: int = int(os.getenv("PORT", "7860"))

# ---------------------------------------------------------------------
# FastAPI App ---------------------------------------------------------
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------
# Падключэнне роўтараў (API модуляў) ---------------------------------
from api.chat import router as chat_router
from api.files import router as files_router
from api.health import router as health_router
from api.teacher import router as teacher_router
from api.voice import router as voice_router
from api.voice_history import router as voice_history_router

app.include_router(chat_router)
app.include_router(files_router)
app.include_router(health_router)
app.include_router(teacher_router)
app.include_router(voice_router)
app.include_router(voice_history_router)

# ---------------------------------------------------------------------
# Загрузка лакальнай ASR мадэлі пры старце (калі ўключана) -----------
@app.on_event("startup")
async def _load_local_asr():
    if config.LOCAL_ASR:
        from api.local_asr import load_asr_model
        import asyncio
        log.info("[STARTUP] LOCAL_ASR=True → loading ASR model in background…")
        asyncio.create_task(asyncio.to_thread(load_asr_model))

# ---------------------------------------------------------------------
# Падрубанне інтэрфейсу (Static Files) --------------------------------
from fastapi.staticfiles import StaticFiles

if os.path.exists("frontend/dist"):
    log.info("✅ Інтэрфейс знойдзены! Падключаем...")
    app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="static")
else:
    log.warning("❌ Увага: frontend/dist не знойдзены!")

# ---------------------------------------------------------------------
# Запуск сервера -------------------------------------------------------
if __name__ == "__main__":
    log.info("Запуск сервера Uvicorn...")
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=PORT,
        proxy_headers=True,
        forwarded_allow_ips="*",
    )
