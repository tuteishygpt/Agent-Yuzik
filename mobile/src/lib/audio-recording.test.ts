const mockExpoAudio = {
  requestRecordingPermissionsAsync: jest.fn(),
  setAudioModeAsync: jest.fn(),
  AudioRecorder: jest.fn(),
};

jest.mock("expo-audio/build/AudioModule", () => ({
  __esModule: true,
  default: mockExpoAudio,
}));

jest.mock("expo-file-system/legacy", () => ({
  EncodingType: {
    Base64: "base64",
  },
  readAsStringAsync: jest.fn(),
}));

import { createVoiceRecorderAdapter } from "./audio-recording";

function createRecorder() {
  return {
    prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
    record: jest.fn(),
    stop: jest.fn().mockResolvedValue(undefined),
    getStatus: jest.fn(() => ({ isRecording: true, metering: -30, url: null })),
    uri: "file:///tmp/voice.m4a",
  };
}

describe("audio recording adapter (expo-audio)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExpoAudio.requestRecordingPermissionsAsync.mockResolvedValue({
      granted: true,
    });
    mockExpoAudio.setAudioModeAsync.mockResolvedValue(undefined);
  });

  it("requests microphone permission before preparing the recorder", async () => {
    const recorder = createRecorder();
    const adapter = createVoiceRecorderAdapter(recorder as any);

    await adapter.prepare();

    expect(mockExpoAudio.requestRecordingPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockExpoAudio.setAudioModeAsync).toHaveBeenCalledTimes(1);
    expect(recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1);
  });

  it("does not prepare recording when microphone permission is denied", async () => {
    mockExpoAudio.requestRecordingPermissionsAsync.mockResolvedValue({
      granted: false,
    });
    const recorder = createRecorder();
    const adapter = createVoiceRecorderAdapter(recorder as any);

    await expect(adapter.prepare()).rejects.toThrow(
      "Microphone permission is required for voice recording.",
    );

    expect(mockExpoAudio.setAudioModeAsync).not.toHaveBeenCalled();
    expect(recorder.prepareToRecordAsync).not.toHaveBeenCalled();
  });

  it("starts recording and provides metering via polling", async () => {
    jest.useFakeTimers();
    const recorder = createRecorder();
    const adapter = createVoiceRecorderAdapter(recorder as any);
    const onMetering = jest.fn();

    await adapter.prepare();
    await adapter.start(onMetering);

    expect(recorder.record).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(100);
    expect(onMetering).toHaveBeenCalledWith(-30);

    jest.useRealTimers();
  });

  it("stop returns null if not recording", async () => {
    const recorder = createRecorder();
    const adapter = createVoiceRecorderAdapter(recorder as any);

    const result = await adapter.stop();
    expect(result).toEqual({ uri: null, wavBytes: null });
    expect(recorder.stop).not.toHaveBeenCalled();
  });
});
