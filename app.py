from __future__ import annotations
import logging
import time
import os
from dotenv import load_dotenv

# Загрузка переменных окружения
load_dotenv()

# Убедимся, что GOOGLE_API_KEY установлен (библиотека google-genai ищет именно его)
if "GEMINI_API_KEY" in os.environ and "GOOGLE_API_KEY" not in os.environ:
    os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]

import mimetypes
import shutil
from pathlib import Path
from typing import Any, Dict, List
from datetime import datetime
import random
import config
from google import genai
from google.genai import types

# ---------------------------------------------------------------------
# Канфігурацыя і Лагаванне -------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s │ %(levelname)s │ %(name)s │ %(message)s",
)
log = logging.getLogger("app")

PORT: int = int(os.getenv("PORT", "7860"))

FILES_DIR = Path("files").resolve()
FILES_DIR.mkdir(exist_ok=True)

import uvicorn
from fastapi import FastAPI
# Removed RedirectResponse as it was used for the / -> /ui redirect


# Імпарты з вашага праекта
from services.adk_service import ADKService
from tools.text_to_speech_tool import register_voice_user, unregister_voice_user, stream_speech

# ---------------------------------------------------------------------
# Ініцыялізацыя Сэрвісаў ---------------------------------------------

adk_service = None
try:
    adk_service = ADKService()
    log.info("Экзэмпляр ADKService паспяхова створаны.")
except Exception as e:
    log.error("КРЫТЫЧНАЯ ПАМЫЛКА: Не атрымалася ініцыялізаваць ADKService: %s", e)
    # У выпадку памылкі мы дазваляем працэсу працягвацца, каб паказаць памылку ў логах,
    # але рэальныя запыты будуць падаць з AttributeError

# ---------------------------------------------------------------------
# FastAPI App ---------------------------------------------------------
app = FastAPI()

# Global Gemini Client (Lazy init)
genai_client = None

def get_genai_client():
    global genai_client
    if not genai_client:
        genai_client = genai.Client(api_key=config.GEMINI_API_KEY)
    return genai_client

# CORS for frontend
from fastapi.middleware.cors import CORSMiddleware
from fastapi import File, UploadFile, Form, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from typing import List, Optional
import asyncio
import json

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Store chat history in memory (per user)
chat_histories: Dict[str, List[Dict]] = {}

# ---------------------------------------------------------------------
# REST API Endpoints --------------------------------------------------

@app.post("/api/chat")
async def api_chat(
    text: str = Form(""),
    user_id: str = Form("default"),
    files: List[UploadFile] = File(default=[]),
):
    """Handle chat messages from the frontend"""
    session_id = await adk_service.get_or_create_session(user_id)
    
    if user_id not in chat_histories:
        chat_histories[user_id] = []
    
    response = {"text": None, "audio": None, "image": None}
    
    # Process files if any
    for uploaded_file in files:
        try:
            file_bytes = await uploaded_file.read()
            mime = uploaded_file.content_type or _guess_mime(Path(uploaded_file.filename))
            
            # Save file
            file_path = FILES_DIR / uploaded_file.filename
            with open(file_path, "wb") as f:
                f.write(file_bytes)
            
            text_reply, delta, parts = adk_service.run_agent(
                session_id=session_id,
                user_id=user_id,
                text=text if text else None,
                file_data=file_bytes,
                mime_type=mime,
            )
            
            if text_reply:
                response["text"] = text_reply
            
            # Handle artifacts (audio/image)
            for filename, version in delta.items():
                try:
                    part = await adk_service.artifact_service.load_artifact(
                        app_name=getattr(adk_service, "app_name", "app"),
                        user_id=user_id,
                        session_id=session_id,
                        filename=filename,
                        version=version,
                    )
                    if part and getattr(part, "inline_data", None) and getattr(part.inline_data, "data", None):
                        artifact_path = FILES_DIR / filename
                        with open(artifact_path, "wb") as f:
                            f.write(part.inline_data.data)
                        
                        mime_type = getattr(part.inline_data, "mime_type", "")
                        if mime_type.startswith("audio"):
                            response["audio"] = f"/api/files/{filename}"
                        elif mime_type.startswith("image"):
                            response["image"] = f"/api/files/{filename}"
                except Exception as e:
                    log.error(f"Error loading artifact: {e}")
            
            text = ""  # Clear text after first file
            
        except Exception as e:
            log.exception(f"Error processing file: {e}")
    
    # Process text-only message
    if text and not files:
        try:
            text_reply, delta, parts = adk_service.run_agent(
                session_id=session_id,
                user_id=user_id,
                text=text,
                file_data=None,
                mime_type=None,
            )
            
            if text_reply:
                response["text"] = text_reply
            
            # Handle artifacts
            for filename, version in delta.items():
                try:
                    part = await adk_service.artifact_service.load_artifact(
                        app_name=getattr(adk_service, "app_name", "app"),
                        user_id=user_id,
                        session_id=session_id,
                        filename=filename,
                        version=version,
                    )
                    if part and getattr(part, "inline_data", None) and getattr(part.inline_data, "data", None):
                        artifact_path = FILES_DIR / filename
                        with open(artifact_path, "wb") as f:
                            f.write(part.inline_data.data)
                        
                        mime_type = getattr(part.inline_data, "mime_type", "")
                        if mime_type.startswith("audio"):
                            response["audio"] = f"/api/files/{filename}"
                        elif mime_type.startswith("image"):
                            response["image"] = f"/api/files/{filename}"
                except Exception as e:
                    log.error(f"Error loading artifact: {e}")
                    
        except Exception as e:
            log.exception(f"Error running agent: {e}")
            response["text"] = "Прабачце, адбылася памылка. Паспрабуйце яшчэ раз."
    
    # Store in history
    if text:
        chat_histories[user_id].append({"role": "user", "content": text})
    if response["text"]:
        chat_histories[user_id].append({"role": "assistant", "content": response["text"]})
    
    return response


@app.get("/api/chat/history")
async def get_chat_history(user_id: str = "default"):
    """Get chat history for a user"""
    return {"history": chat_histories.get(user_id, [])}


@app.delete("/api/chat/history")
async def clear_chat_history(user_id: str = "default"):
    """Clear chat history for a user"""
    if user_id in chat_histories:
        chat_histories[user_id] = []
    return {"status": "ok"}


@app.get("/api/files/{filename}")
async def get_file(filename: str):
    """Serve files (audio, images, etc.)"""
    file_path = FILES_DIR / filename
    if not file_path.exists():
        return {"error": "File not found"}, 404
    
    mime = _guess_mime(file_path)
    return FileResponse(file_path, media_type=mime)


# WebSocket for real-time voice agent
# Global dictionary to track active voice tasks for interruption
active_voice_tasks: Dict[str, asyncio.Task] = {}

@app.websocket("/api/voice")
async def voice_websocket(websocket: WebSocket, user_id: str = "voice_user"):
    """Real-time voice conversation with the agent"""
    await websocket.accept()
    log.info(f"Voice WebSocket connected for user {user_id}")
    
    session_id = await adk_service.get_or_create_session(user_id)
    
    # Create queue for streaming audio and register user
    audio_queue = asyncio.Queue()
    loop = asyncio.get_running_loop()
    register_voice_user(user_id, audio_queue, loop)
    
    # Accumulator for continuous audio upload
    audio_accumulator = bytearray()
    
    async def audio_sender():
        """Consumes audio chunks from queue and sends to websocket"""
        try:
            while True:
                chunk = await audio_queue.get()
                if chunk is None: break # Sentinel
                await websocket.send_bytes(chunk)
                audio_queue.task_done()
        except Exception as e:
            log.error(f"Audio sender error: {e}")

    # Start audio sender task
    sender_task = asyncio.create_task(audio_sender())

    async def process_voice_message(audio_data: bytes):
        """Internal helper to process voice and send streamed response"""
        try:
            start_ts = time.time()
            perf_logs = []
            
            def perf_log(msg: str):
                log.info(msg)
                perf_logs.append(msg)
                
            perf_log(f"[Perf] Server: Audio Received. Size: {len(audio_data)} bytes. TS: {start_ts}")
            await websocket.send_json({"type": "processing"})
            
            collected_text = []
            
            # Check if Simple Voice Agent mode is enabled
            if config.SIMPLE_VOICE_AGENT:
                perf_log(f"[Perf] Using Simple Voice Agent (Model: {config.SIMPLE_VOICE_MODEL}). Overhead: {time.time() - start_ts:.3f}s")
                gen_start = time.time()
                
                try:
                    # Initialize Gemini Client
                    client = get_genai_client()
                    prompt = config.SIMPLE_VOICE_SYSTEM_PROMPT
                    
                    # Generate content STREAM
                    # We stream text from LLM, and as soon as we have a full sentence, we trigger TTS
                    response_stream = await client.aio.models.generate_content_stream(
                        model=config.SIMPLE_VOICE_MODEL,
                        contents=[
                            types.Content(
                                role="user",
                                parts=[
                                    types.Part(
                                        inline_data=types.Blob(
                                            mime_type="audio/wav",
                                            data=audio_data
                                        )
                                    )
                                ]
                            )
                        ],
                        config=types.GenerateContentConfig(
                            system_instruction=prompt,
                            temperature=0.7
                        )
                    )
                    
                    perf_log(f"[Perf] Gemini Stream Started. TTFT: {time.time() - gen_start:.3f}s")
                    
                    text_buffer = ""
                    sentence_buffer = ""
                    first_token = True
                    sent_first_audio_chunk = False
                    
                    # Internal queue for sentences to be processed by TTS
                    tts_sentence_queue = asyncio.Queue()
                    
                    async def tts_worker():
                        nonlocal sent_first_audio_chunk
                        try:
                            while True:
                                sentence = await tts_sentence_queue.get()
                                if sentence is None: break # Sentinel
                                
                                log.info(f"TTS Worker: Processing sentence: {sentence[:30]}...")
                                async for audio_chunk in stream_speech(sentence):
                                    if not sent_first_audio_chunk:
                                        perf_log(f"[Perf] First TTS Chunk sent. Pipeline Latency: {time.time() - start_ts:.3f}s")
                                        sent_first_audio_chunk = True
                                    # Use the user's audio_queue which is consumed by the audio_sender task
                                    await audio_queue.put(audio_chunk)
                                tts_sentence_queue.task_done()
                        except Exception as e:
                            log.error(f"TTS Worker Error: {e}")

                    # Start worker
                    worker_task = asyncio.create_task(tts_worker())
                    
                    try:
                        async for chunk in response_stream:
                            if chunk.text:
                                if first_token:
                                    perf_log(f"[Perf] First LLM Token. Latency: {time.time() - gen_start:.3f}s")
                                    first_token = False
                                    
                                text_chunk = chunk.text
                                text_buffer += text_chunk
                                sentence_buffer += text_chunk
                                
                                # Send intermediate text to UI for live transcription
                                await websocket.send_json({
                                    "type": "response",
                                    "text": text_buffer # Send full accumulated text for simple UI update
                                })

                                # Check for sentence delimiters logic removed. 
                                # We wait for the full text to accumulate in sentence_buffer and send it all at once after the loop.

                        # Process remaining text in buffer
                        if sentence_buffer.strip():
                             await tts_sentence_queue.put(sentence_buffer)

                        # Wait for all TTS to finish
                        await tts_sentence_queue.put(None) # Sentinel
                        await worker_task
                    finally:
                        if not worker_task.done():
                            worker_task.cancel()

                    perf_log(f"[Perf] LLM Stream Complete. Total Gen Time: {time.time() - gen_start:.3f}s")
                    
                    # Send Debug Info if enabled
                    if config.SIMPLE_VOICE_DEBUG_TIMESTAMPS:
                        debug_msg = "\n".join(perf_logs)
                        await websocket.send_json({
                            "type": "response",
                            "text": f"\n\n--- Debug Timestamps (Streamed) ---\n{debug_msg}"
                        })

                except Exception as genai_err:
                    log.error(f"Gemini API Error: {genai_err}")
                    await websocket.send_json({"type": "error", "message": f"Gemini Error: {str(genai_err)}"})

            else:
                # Start streaming the agent response via ADK Service
                async for ev in adk_service.run_agent_stream(
                    session_id=session_id,
                    user_id=user_id,
                    text=None,
                    file_data=audio_data,
                    mime_type="audio/wav", 
                ):
                    # Handle text response
                    if ev.is_final_response() and ev.content:
                        text_parts = [p.text for p in ev.content.parts if p.text]
                        if text_parts:
                            full_text = "\n".join(text_parts)
                            # Avoid sending "[Audio streamed directly]" if it leaks
                            if "[Audio streamed directly]" not in full_text:
                                collected_text.append(full_text)
                                await websocket.send_json({
                                    "type": "response",
                                    "text": full_text
                                })
                    
                    # Handle generated audio (Legacy/Standard Artifacts)
                    if ev.actions and ev.actions.artifact_delta:
                        for filename, version in ev.actions.artifact_delta.items():
                            try:
                                # Load and send audio artifact immediately
                                part = await adk_service.artifact_service.load_artifact(
                                    app_name=adk_service.app_name,
                                    user_id=user_id,
                                    session_id=session_id,
                                    filename=filename,
                                    version=version,
                                )
                                if part and getattr(part, "inline_data", None):
                                    if getattr(part.inline_data, "mime_type", "").startswith("audio"):
                                        # Send raw audio bytes
                                        await websocket.send_bytes(part.inline_data.data)
                            except Exception as e:
                                log.error(f"Error loading audio artifact: {e}")
            
            # After agent finishes, automatically stream TTS for collected text
                            except Exception as e:
                                log.error(f"Error loading audio artifact: {e}")
            
            # NOTE: For Simple Voice Agent, TTS is handled inside the 'if' block above (streamed).
            # The code below is only for the ADK agent path (legacy/non-simple).
            if not config.SIMPLE_VOICE_AGENT and collected_text:
                final_text = " ".join(collected_text)
                perf_log(f"[Perf] Streaming TTS for voice response. Text Len: {len(final_text)}. Time from start: {time.time() - start_ts:.3f}s")
                tts_start = time.time()
                first_chunk = True
                try:
                    async for chunk in stream_speech(final_text):
                        if first_chunk:
                            perf_log(f"[Perf] First TTS Audio Chunk Yielded. TTS Latency: {time.time() - tts_start:.3f}s")
                            first_chunk = False
                        await websocket.send_bytes(chunk)
                        
                    # Send Debug Info if enabled
                    if config.SIMPLE_VOICE_DEBUG_TIMESTAMPS:
                        debug_msg = "\n".join(perf_logs)
                        await websocket.send_json({
                            "type": "response",
                            "text": f"\n\n--- Debug Timestamps ---\n{debug_msg}"
                        })

                except Exception as tts_err:
                    log.error(f"TTS streaming error: {tts_err}")
                            
        except Exception as e:
            log.exception(f"Error in process_voice_message: {e}")
            try:
                await websocket.send_json({"type": "error", "message": str(e)})
            except: pass
            
    try:
        while True:
            # We use wait_for or similar to handle both binary and text data
            data = await websocket.receive()
            
            # Check for disconnect
            if data.get("type") == "websocket.disconnect":
                log.info(f"WebSocket disconnect received for user {user_id}")
                break
            
            if "bytes" in data:
                # Continuous streaming: append raw chunks to accumulator
                audio_accumulator.extend(data["bytes"])
                
            elif "text" in data:
                msg = json.loads(data["text"])
                msg_type = msg.get("type")

                if msg_type == "end_audio":
                    if not audio_accumulator:
                        continue
                        
                    log.info(f"Received end_audio. Accumulated {len(audio_accumulator)} bytes. Starting processing...")
                    
                    # Wrap accumulated raw PCM into a WAV file for Gemini
                    # (Assuming frontend sends 16kHz 16-bit Mono PCM)
                    import struct
                    def create_wav_header(data_len):
                        header = struct.pack('<4sI4s4sIHHIIHH4sI', 
                            b'RIFF', data_len + 36, b'WAVE', b'fmt ', 16, 1, 1, 16000, 32000, 2, 16, b'data', data_len)
                        return header

                    full_wav = create_wav_header(len(audio_accumulator)) + audio_accumulator
                    
                    # Cancel previous task if still running
                    if user_id in active_voice_tasks and not active_voice_tasks[user_id].done():
                        active_voice_tasks[user_id].cancel()
                    
                    task = asyncio.create_task(process_voice_message(full_wav))
                    active_voice_tasks[user_id] = task
                    
                    # Clear accumulator for next utterance
                    audio_accumulator = bytearray()
                
                elif msg_type == "interrupt":
                    log.info(f"Interruption received for user {user_id}")
                    # Clear queue
                    while not audio_queue.empty():
                        try: audio_queue.get_nowait()
                        except: pass
                    
                    if user_id in active_voice_tasks:
                        active_voice_tasks[user_id].cancel()
                        del active_voice_tasks[user_id]
                    await websocket.send_json({"type": "interruption_handshake"})
                
                elif msg_type == "end_audio":
                    # Handled by receiving bytes in our current logic
                    pass

    except WebSocketDisconnect:
        log.info(f"Voice WebSocket disconnected for user {user_id}")
    except Exception as e:
        log.exception(f"Voice WebSocket error: {e}")
    finally:
        unregister_voice_user(user_id)
        if sender_task:
            sender_task.cancel()
        if user_id in active_voice_tasks:
            active_voice_tasks[user_id].cancel()
            del active_voice_tasks[user_id]


# ---------------------------------------------------------------------
# Утыліты -------------------------------------------------------------


def _guess_mime(p: Path) -> str:
    mime, _ = mimetypes.guess_type(str(p))
    if mime:
        return mime
    lower = p.suffix.lower()
    if lower == ".pdf":
        return "application/pdf"
    if lower in {".txt", ".md"}:
        return "text/plain"
    return "application/octet-stream"



if __name__ == "__main__":
    log.info("Запуск сервера Uvicorn...")
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=PORT,
        proxy_headers=True,
        forwarded_allow_ips='*',
    )
