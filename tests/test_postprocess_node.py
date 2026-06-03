import pytest
from google.genai import types

from yuzik_workflow.postprocess import collect_artifacts, media_from_parts, media_kind


def test_media_kind_classifies_audio_image_and_files():
    assert media_kind("audio/wav") == "audio"
    assert media_kind("image/png") == "image"
    assert media_kind("application/pdf") == "file"
    assert media_kind(None) == "file"


def test_media_from_parts_converts_inline_data_to_chat_media():
    parts = [
        types.Part(text="hello"),
        types.Part(inline_data=types.Blob(data=b"wav", mime_type="audio/wav")),
        types.Part(inline_data=types.Blob(data=b"png", mime_type="image/png")),
    ]

    media = media_from_parts(parts)

    assert [(item.kind, item.filename, item.mime_type, item.data) for item in media] == [
        ("audio", "part-1", "audio/wav", b"wav"),
        ("image", "part-2", "image/png", b"png"),
    ]


@pytest.mark.asyncio
async def test_collect_artifacts_persists_delta_as_chat_media():
    class ArtifactService:
        async def load_artifact(self, **kwargs):
            assert kwargs["filename"] == "tts_output.wav"
            assert kwargs["version"] == 3
            return types.Part(inline_data=types.Blob(data=b"audio", mime_type="audio/wav"))

    class ADKService:
        app_name = "yuzik_workflow"
        artifact_service = ArtifactService()

    class ArtifactStore:
        def store_assistant_artifact(self, **kwargs):
            assert kwargs["adk_session_row_id"] == "row-1"
            return {"id": "artifact-1"}

        def get_download_url(self, row):
            return f"https://files/{row['id']}"

    class SessionStore:
        def get_active_session(self, user_id, app_name):
            return {"id": "row-1"}

    media = await collect_artifacts(
        adk_service=ADKService(),
        artifact_store=ArtifactStore(),
        adk_session_store=SessionStore(),
        user_id="u1",
        session_id="s1",
        conversation_id="c1",
        artifact_delta={"tts_output.wav": 3},
    )

    assert len(media) == 1
    assert media[0].kind == "audio"
    assert media[0].url == "https://files/artifact-1"
