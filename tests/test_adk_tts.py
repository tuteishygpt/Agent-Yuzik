import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
sys.stdout.reconfigure(encoding='utf-8')

import asyncio
from services.adk_service import ADKService
from tools.text_to_speech_tool import register_voice_user
import config

async def main():
    service = ADKService()
    session_id = await service.get_or_create_session("test_user")
    
    print("Testing ADK TTS...")
    
    queue = asyncio.Queue()
    register_voice_user("test_user", queue, asyncio.get_running_loop())
    
    # We will test streaming
    async for ev in service.run_agent_stream(session_id, "test_user", "Прывітанне! Агуч гэты тэкст праз synthesize_speech_tool: Прывітанне свет!", None, None):
        if ev.is_final_response() and ev.content:
            text_parts = [p.text for p in ev.content.parts if p.text]
            print(f"Final response: {text_parts}")
            
        if ev.actions:
            if getattr(ev.actions, 'tool_calls', None):
                print("Tool call:", ev.actions.tool_calls)
            
if __name__ == "__main__":
    asyncio.run(main())
