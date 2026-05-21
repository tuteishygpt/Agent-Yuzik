const mockNativeTenVad = {
  create: jest.fn(),
  processPcm16: jest.fn(),
  reset: jest.fn(),
  destroy: jest.fn(),
};

jest.mock("react-native", () => ({
  NativeModules: {
    TenVad: mockNativeTenVad,
  },
  Platform: {
    OS: "android",
  },
}));

const { createVad } = require("./vad") as typeof import("./vad");

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createVad", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNativeTenVad.create.mockResolvedValue(null);
    mockNativeTenVad.processPcm16.mockResolvedValue([]);
    mockNativeTenVad.reset.mockResolvedValue(null);
    mockNativeTenVad.destroy.mockResolvedValue(null);
  });

  it("fires onSpeechStart after minSpeechFrames above threshold", () => {
    const onSpeechStart = jest.fn();
    const onSpeechEnd = jest.fn();
    const vad = createVad(
      { onSpeechStart, onSpeechEnd },
      { positiveSpeechThreshold: -35, minSpeechFrames: 3 },
    );

    vad.processFrame(-40); // below threshold
    expect(onSpeechStart).not.toHaveBeenCalled();

    vad.processFrame(-30); // above
    vad.processFrame(-25); // above
    expect(onSpeechStart).not.toHaveBeenCalled();

    vad.processFrame(-20); // above — 3rd consecutive
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
  });

  it("fires onSpeechEnd after redemptionFrames of silence", () => {
    const onSpeechStart = jest.fn();
    const onSpeechEnd = jest.fn();
    const vad = createVad(
      { onSpeechStart, onSpeechEnd },
      {
        positiveSpeechThreshold: -35,
        negativeSpeechThreshold: -50,
        minSpeechFrames: 2,
        redemptionFrames: 3,
      },
    );

    // Start speech
    vad.processFrame(-20);
    vad.processFrame(-20);
    expect(vad.isSpeaking).toBe(true);

    // Silence frames
    vad.processFrame(-60);
    vad.processFrame(-60);
    expect(onSpeechEnd).not.toHaveBeenCalled();

    vad.processFrame(-60); // 3rd silence frame
    expect(onSpeechEnd).toHaveBeenCalledTimes(1);
    expect(vad.isSpeaking).toBe(false);
  });

  it("does not fire when paused", () => {
    const onSpeechStart = jest.fn();
    const vad = createVad(
      { onSpeechStart, onSpeechEnd: jest.fn() },
      { positiveSpeechThreshold: -35, minSpeechFrames: 2 },
    );

    vad.pause();
    vad.processFrame(-20);
    vad.processFrame(-20);
    vad.processFrame(-20);
    expect(onSpeechStart).not.toHaveBeenCalled();
    expect(vad.isPaused).toBe(true);
  });

  it("resets state on resume", () => {
    const onSpeechStart = jest.fn();
    const vad = createVad(
      { onSpeechStart, onSpeechEnd: jest.fn() },
      { positiveSpeechThreshold: -35, minSpeechFrames: 3 },
    );

    vad.processFrame(-20);
    vad.processFrame(-20); // 2 frames accumulated
    vad.pause();
    vad.resume();

    // Need full 3 frames again after resume
    vad.processFrame(-20);
    vad.processFrame(-20);
    expect(onSpeechStart).not.toHaveBeenCalled();
    vad.processFrame(-20);
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
  });

  it("detects the short Android live-stream speech burst seen in device logs", () => {
    const onSpeechStart = jest.fn();
    const vad = createVad({ onSpeechStart, onSpeechEnd: jest.fn() });

    [
      -67.62,
      -67.42,
      -66.11,
      -68.02,
      -45.93,
      -32.2,
      -33.43,
      -35.69,
      -40.72,
      -44.97,
    ].forEach((db) => vad.processFrame(db));

    expect(onSpeechStart).toHaveBeenCalledTimes(1);
  });

  it("uses TEN VAD for Android PCM frames when native module is available", async () => {
    mockNativeTenVad.processPcm16.mockResolvedValue([
      { probability: 0.82, isSpeech: true },
      { probability: 0.12, isSpeech: false },
    ]);
    const onSpeechStart = jest.fn();
    const onSpeechEnd = jest.fn();
    const vad = createVad(
      { onSpeechStart, onSpeechEnd },
      {
        preferNativeTenVad: true,
        minSpeechFrames: 1,
        redemptionFrames: 1,
        tenVadThreshold: 0.6,
        tenVadHopSize: 256,
      },
    );
    const pcm = new Uint8Array(512);

    vad.processFrame(-24, pcm);
    await flushPromises();

    expect(mockNativeTenVad.create).toHaveBeenCalledWith(256, 0.6);
    expect(mockNativeTenVad.processPcm16).toHaveBeenCalledWith(
      Buffer.from(pcm).toString("base64"),
    );
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
    expect(onSpeechEnd).toHaveBeenCalledTimes(1);
  });

  it("falls back to energy VAD when native TEN VAD is disabled", () => {
    const onSpeechStart = jest.fn();
    const vad = createVad(
      { onSpeechStart, onSpeechEnd: jest.fn() },
      {
        preferNativeTenVad: false,
        positiveSpeechThreshold: -35,
        minSpeechFrames: 2,
      },
    );

    vad.processFrame(-20, new Uint8Array(512));
    vad.processFrame(-20, new Uint8Array(512));

    expect(mockNativeTenVad.processPcm16).not.toHaveBeenCalled();
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
  });
});
