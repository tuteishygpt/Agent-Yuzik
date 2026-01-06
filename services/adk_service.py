# services/adk_service.py

import logging
from typing import List, Dict, Tuple

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.artifacts import InMemoryArtifactService
from google.genai import types
# Імпарт genai_errors больш не патрэбны тут
from router_agent.agent import router_agent 
from bot import helpers                    

log = logging.getLogger(__name__)

class ADKService:
    def __init__(self):
        log.info("Initializing ADKService with REAL components...")
        self.artifact_service = InMemoryArtifactService()
        self.session_service = InMemorySessionService()
        self.runner = Runner(
            agent=router_agent,
            app_name=router_agent.name,
            session_service=self.session_service,
            artifact_service=self.artifact_service,
        )
        self.app_name = router_agent.name
        self.user_sessions: Dict[str, str] = {}

    async def get_or_create_session(self, user_id: str) -> str:
        # (без змен)
        if user_id not in self.user_sessions:
            log.info(f"Creating new session for user {user_id}")
            session = await self.session_service.create_session(
                app_name=self.app_name, user_id=user_id
            )
            self.user_sessions[user_id] = session.id
        return self.user_sessions[user_id]

    def run_agent(
        self, session_id: str, user_id: str, text: str | None, file_data: bytes | None = None, mime_type: str | None = None
    ) -> Tuple[str, Dict, List[types.Part]]:
        """Запускае агент з тэкстам і/або дадзенымі файла (сінхронна)."""
        
        parts = []
        if text:
            parts.append(types.Part(text=text))
        if file_data and mime_type:
            blob = types.Blob(data=file_data, mime_type=mime_type)
            parts.append(types.Part(inline_data=blob))

        if not parts:
            return "", {}, []
        
        content = types.Content(role="user", parts=parts)
        final_parts, delta = [], {}
        
        for ev in self.runner.run(user_id=user_id, session_id=session_id, new_message=content):
            if ev.is_final_response() and ev.content:
                final_parts = ev.content.parts or []
            if ev.actions and ev.actions.artifact_delta:
                delta.update(ev.actions.artifact_delta)

        reply = "\n".join(p.text for p in final_parts if p.text)
        return reply, delta, final_parts

    async def run_agent_stream(
        self, session_id: str, user_id: str, text: str | None, file_data: bytes | None = None, mime_type: str | None = None
    ):
        """Запускае агент і вяртае генератар падзей."""
        parts = []
        if text:
            parts.append(types.Part(text=text))
        if file_data and mime_type:
            # Check if it is already WAV from our new VAD
            if mime_type == "audio/wav" or (file_data.startswith(b'RIFF') and file_data[8:12] == b'WAVE'):
                blob = types.Blob(data=file_data, mime_type="audio/wav")
            else:
                blob = types.Blob(data=file_data, mime_type=mime_type)
            parts.append(types.Part(inline_data=blob))

        if not parts:
            return

        content = types.Content(role="user", parts=parts)
        
        
        # True streaming using a queue to bridge sync runner and async generator
        import asyncio
        from concurrent.futures import ThreadPoolExecutor
        
        loop = asyncio.get_running_loop()
        event_queue = asyncio.Queue()
        
        def sync_run_and_push():
            try:
                for ev in self.runner.run(user_id=user_id, session_id=session_id, new_message=content):
                    loop.call_soon_threadsafe(event_queue.put_nowait, ev)
            except Exception as e:
                log.error(f"Error in sync runner: {e}")
                # Optionally push error to queue or handle it
            finally:
                loop.call_soon_threadsafe(event_queue.put_nowait, None) # Sentinel

        # Fire and forget the thread (or keep ref to verify completion)
        executor = ThreadPoolExecutor(max_workers=1)
        loop.run_in_executor(executor, sync_run_and_push)

        while True:
            ev = await event_queue.get()
            if ev is None:
                break
            yield ev

    async def send_media_from_parts(
        self, chat_id: int, context, parts: List[types.Part]
    ) -> Tuple[bool, bytes | None, bytes | None]:
        # (без змен)
        wavs, imgs = [], []
        for p in parts:
            if p.inline_data and p.inline_data.data and p.inline_data.mime_type:
                mime = p.inline_data.mime_type
                if mime.startswith("audio"):
                    wavs.append(p.inline_data.data)
                elif mime.startswith("image"):
                    imgs.append(p.inline_data.data)
        sent = False
        if wavs:
            sent |= await helpers.send_wavs(chat_id, context, wavs)
        if imgs:
            sent |= await helpers.send_images(chat_id, context, imgs)
        return sent, (wavs[0] if wavs else None), (imgs[0] if imgs else None)

    async def send_media_from_artifacts(
        self, chat_id: int, context, user_id: str, session_id: str, delta: Dict
    ) -> Tuple[bool, bytes | None, bytes | None]:
        # (без змен)
        wavs, imgs = [], []
        for fname, ver in delta.items():
            try:
                part = await self.artifact_service.load_artifact(
                    app_name=self.app_name, user_id=user_id, session_id=session_id,
                    filename=fname, version=ver
                )
                if part and part.inline_data and part.inline_data.data and part.inline_data.mime_type:
                    mime = part.inline_data.mime_type
                    if mime.startswith("audio"):
                        wavs.append(part.inline_data.data)
                    elif mime.startswith("image"):
                        imgs.append(part.inline_data.data)
            except Exception as exc:
                log.error(f"Failed to load artifact {fname} v{ver}: {exc}")
        sent = False
        if wavs:
            sent |= await helpers.send_wavs(chat_id, context, wavs)
        if imgs:
            sent |= await helpers.send_images(chat_id, context, imgs)
        return sent, (wavs[0] if wavs else None), (imgs[0] if imgs else None)