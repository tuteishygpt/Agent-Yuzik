
from gradio_client import Client, handle_file
import os

def test_prediction():
    client = Client("archivartaunik/BexttsAssist")
    
    text = "Прывітанне, гэта тэст."
    
    # Try calling with None for audio
    try:
        print("Attempting to call /text_to_speech with audio=None...")
        result = client.predict(
            text_input=text,
            speaker_audio=None,
            api_name="/text_to_speech"
        )
        print(f"Result type: {type(result)}")
        print(f"Result: {result}")
    except Exception as e:
        print(f"Call failed: {e}")

if __name__ == "__main__":
    test_prediction()
