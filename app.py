from __future__ import annotations

import asyncio
import logging
import os

from dotenv import load_dotenv

# Загрузка пераменных асяроддзя
load_dotenv()

import uvicorn
from fastapi import FastAPI, Request, Response
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
# Telegram Bot (webhook mode) -----------------------------------------
_tg_app = None

if config.TELEGRAM_BOT_TOKEN:
    from telegram import Update
    from telegram.ext import Application, CommandHandler, MessageHandler, filters

    from api.deps import adk_service
    from bot.handlers import handle_message, start_cmd

    _tg_app = (
        Application.builder()
        .token(config.TELEGRAM_BOT_TOKEN)
        .updater(None)
        .build()
    )
    _tg_app.adk_service = adk_service

    _tg_app.add_handler(CommandHandler("start", start_cmd))
    _tg_app.add_handler(MessageHandler(filters.ALL & ~filters.COMMAND, handle_message))

    @app.post(f"/{config.WEBHOOK_PATH}")
    async def telegram_webhook(request: Request) -> Response:
        if config.WEBHOOK_SECRET_TOKEN:
            token = request.headers.get("X-Telegram-Bot-Api-Secret-Token")
            if token != config.WEBHOOK_SECRET_TOKEN:
                return Response(status_code=403)
        body = await request.json()
        update = Update.de_json(body, _tg_app.bot)
        await _tg_app.process_update(update)
        return Response(status_code=200)
else:
    log.warning("TELEGRAM_BOT_TOKEN not set — Telegram bot disabled")

# ---------------------------------------------------------------------
# Startup / Shutdown --------------------------------------------------
@app.on_event("startup")
async def _startup():
    if config.LOCAL_ASR:
        from api.local_asr import load_asr_model
        log.info("[STARTUP] LOCAL_ASR=True → loading ASR model in background…")
        asyncio.create_task(asyncio.to_thread(load_asr_model))

    if _tg_app:
        await _tg_app.initialize()
        await _tg_app.start()
        await _tg_app.bot.set_webhook(
            url=config.WEBHOOK_URL,
            secret_token=config.WEBHOOK_SECRET_TOKEN,
        )
        log.info("Telegram webhook set: %s", config.WEBHOOK_URL)


@app.on_event("shutdown")
async def _shutdown():
    if _tg_app:
        await _tg_app.stop()
        await _tg_app.shutdown()
        log.info("Telegram bot stopped")

# ---------------------------------------------------------------------
# Падрубанне інтэрфейсу (Static Files) --------------------------------
from fastapi.staticfiles import StaticFiles

if os.path.exists("frontend/dist"):
    log.info("Інтэрфейс знойдзены! Падключаем...")
    app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="static")
else:
    log.warning("Увага: frontend/dist не знойдзены!")

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
