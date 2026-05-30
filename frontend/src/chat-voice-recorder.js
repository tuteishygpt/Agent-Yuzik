const DEFAULT_AUDIO_TYPES = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
];

export function chooseVoiceRecordingMimeType(
    isTypeSupported = (candidate) => MediaRecorder.isTypeSupported(candidate),
    candidates = DEFAULT_AUDIO_TYPES,
) {
    return candidates.find((candidate) => isTypeSupported(candidate)) || "";
}

function extensionForMimeType(mimeType) {
    if (mimeType.includes("mp4")) {
        return "m4a";
    }
    if (mimeType.includes("ogg")) {
        return "ogg";
    }
    if (mimeType.includes("wav")) {
        return "wav";
    }
    return "webm";
}

export function createVoiceRecordingFile({
    chunks,
    mimeType,
    now = Date.now,
}) {
    const type = mimeType || "audio/webm";
    const blob = new Blob(chunks, { type });
    const extension = extensionForMimeType(type);

    return new File([blob], `voice-message-${now()}.${extension}`, { type });
}
