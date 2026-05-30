from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Header, HTTPException, Request, status
from telegram import Update
from telegram.ext import Application, ApplicationBuilder, CommandHandler, MessageHandler, filters

import config
from bot.handlers import handle_message, start_cmd

log = logging.getLogger("app.telegram")

router = APIRouter(tags=["telegram"])

telegram_application: Application | None = None
_telegram_started = False
_telegram_lock = asyncio.Lock()


def _register_handlers(application: Application) -> None:
    application.add_handler(CommandHandler("start", start_cmd))
    application.add_handler(MessageHandler(filters.ALL & ~filters.COMMAND, handle_message))


async def configure_telegram_application(adk_service: object | None) -> Application | None:
    """Build the Telegram application without opening network connections."""
    global telegram_application, _telegram_started

    if not config.TELEGRAM_BOT_TOKEN:
        telegram_application = None
        _telegram_started = False
        log.warning("TELEGRAM_BOT_TOKEN is not set; Telegram webhook is disabled.")
        return None

    if telegram_application is not None:
        telegram_application.bot_data["adk_service"] = adk_service
        return telegram_application

    application = ApplicationBuilder().token(config.TELEGRAM_BOT_TOKEN).build()
    application.bot_data["adk_service"] = adk_service
    _register_handlers(application)
    telegram_application = application
    _telegram_started = False
    log.info("Telegram application configured for webhook path /%s.", config.WEBHOOK_PATH)
    return application


async def ensure_telegram_started() -> Application:
    global _telegram_started

    if telegram_application is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Telegram bot is not configured",
        )

    if _telegram_started:
        return telegram_application

    async with _telegram_lock:
        if not _telegram_started:
            await telegram_application.initialize()
            await telegram_application.start()
            _telegram_started = True
            log.info("Telegram application started.")

    return telegram_application


async def shutdown_telegram_application() -> None:
    global _telegram_started

    if telegram_application is None or not _telegram_started:
        return

    await telegram_application.stop()
    await telegram_application.shutdown()
    _telegram_started = False
    log.info("Telegram application stopped.")


@router.post(f"/{config.WEBHOOK_PATH}")
async def telegram_webhook(
    request: Request,
    x_telegram_bot_api_secret_token: str | None = Header(
        default=None,
        alias="X-Telegram-Bot-Api-Secret-Token",
    ),
):
    if (
        config.WEBHOOK_SECRET_TOKEN
        and x_telegram_bot_api_secret_token != config.WEBHOOK_SECRET_TOKEN
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid Telegram webhook secret token",
        )

    application = await ensure_telegram_started()
    payload = await request.json()
    update = Update.de_json(payload, application.bot)
    await application.process_update(update)
    return {"ok": True}
