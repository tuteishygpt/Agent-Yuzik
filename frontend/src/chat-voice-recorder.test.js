import test from "node:test";
import assert from "node:assert/strict";

import {
    chooseVoiceRecordingMimeType,
    createVoiceRecordingFile,
} from "./chat-voice-recorder.js";

test("chooseVoiceRecordingMimeType returns the first supported type", () => {
    const mimeType = chooseVoiceRecordingMimeType((candidate) => candidate === "audio/mp4", [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/wav",
    ]);

    assert.equal(mimeType, "audio/mp4");
});

test("chooseVoiceRecordingMimeType falls back to browser default when no candidate is supported", () => {
    const mimeType = chooseVoiceRecordingMimeType(() => false, [
        "audio/webm;codecs=opus",
    ]);

    assert.equal(mimeType, "");
});

test("createVoiceRecordingFile creates a named audio file from chunks", async () => {
    const file = createVoiceRecordingFile({
        chunks: [new Blob(["voice"])],
        mimeType: "audio/webm;codecs=opus",
        now: () => 1234567890,
    });

    assert.equal(file.name, "voice-message-1234567890.webm");
    assert.equal(file.type, "audio/webm;codecs=opus");
    assert.equal(await file.text(), "voice");
});
