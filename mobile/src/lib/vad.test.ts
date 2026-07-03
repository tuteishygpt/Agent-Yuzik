const mockNativeTenVad = {
  create: jest.fn(),
  processPcm16: jest.fn(),
  reset: jest.fn(),
  destroy: jest.fn(),
};
const mockPlatform = {
  OS: "android",
};
const mockWebTenVad = {
  create: jest.fn(),
  processPcm16: jest.fn(),
  reset: jest.fn(),
  destroy: jest.fn(),
};
const mockCreateWebTenVad = jest.fn(() => mockWebTenVad);

jest.mock("react-native", () => ({
  NativeModules: {
    TenVad: mockNativeTenVad,
  },
  Platform: mockPlatform,
}));

jest.mock("./ten-vad-web", () => ({
  createWebTenVad: mockCreateWebTenVad,
}));

const { createVad } = require("./vad") as typeof import("./vad");

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createVad", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPlatform.OS = "android";
    mockNativeTenVad.create.mockResolvedValue(null);
    mockNativeTenVad.processPcm16.mockResolvedValue([]);
    mockNativeTenVad.reset.mockResolvedValue(null);
    mockNativeTenVad.destroy.mockResolvedValue(null);
    mockWebTenVad.create.mockResolvedValue(null);
    mockWebTenVad.processPcm16.mockResolvedValue([]);
    mockWebTenVad.reset.mockResolvedValue(null);
    mockWebTenVad.destroy.mockResolvedValue(null);
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

  it("ends speech after the level drops far below the speech peak", () => {
    const onSpeechStart = jest.fn();
    const onSpeechEnd = jest.fn();
    const vad = createVad(
      { onSpeechStart, onSpeechEnd },
      {
        positiveSpeechThreshold: -55,
        negativeSpeechThreshold: -60,
        minSpeechFrames: 1,
        redemptionFrames: 3,
        speechEndPeakDropDb: 25,
      },
    );

    vad.processFrame(-21);
    expect(onSpeechStart).toHaveBeenCalledTimes(1);

    vad.processFrame(-50.5);
    vad.processFrame(-50.5);
    expect(onSpeechEnd).not.toHaveBeenCalled();

    vad.processFrame(-50.5);
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
        nativeTenVadCalibrationFrames: 0,
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

  it("does not let TEN VAD start speech on low-energy emulator noise", async () => {
    mockNativeTenVad.processPcm16.mockResolvedValue([
      { probability: 0.92, isSpeech: true },
      { probability: 0.91, isSpeech: true },
      { probability: 0.9, isSpeech: true },
    ]);
    const onSpeechStart = jest.fn();
    const vad = createVad(
      { onSpeechStart, onSpeechEnd: jest.fn() },
      {
        preferNativeTenVad: true,
        minSpeechFrames: 1,
        nativeTenVadEnergyFloorDb: -65,
        nativeTenVadCalibrationFrames: 0,
      },
    );

    vad.processFrame(-72, new Uint8Array(512));
    await flushPromises();

    expect(onSpeechStart).not.toHaveBeenCalled();
  });

  it("lets TEN VAD start speech below the energy VAD positive threshold", async () => {
    mockNativeTenVad.processPcm16.mockResolvedValue([
      { probability: 0.92, isSpeech: true },
    ]);
    const onSpeechStart = jest.fn();
    const vad = createVad(
      { onSpeechStart, onSpeechEnd: jest.fn() },
      {
        preferNativeTenVad: true,
        minSpeechFrames: 1,
        positiveSpeechThreshold: -40,
        nativeTenVadEnergyFloorDb: -65,
        nativeTenVadCalibrationFrames: 0,
      },
    );

    vad.processFrame(-52, new Uint8Array(512));
    await flushPromises();

    expect(onSpeechStart).toHaveBeenCalledTimes(1);
  });

  it("adapts the TEN VAD energy floor from quiet startup frames", async () => {
    mockNativeTenVad.processPcm16.mockResolvedValue([
      { probability: 0.1, isSpeech: false },
      { probability: 0.1, isSpeech: false },
      { probability: 0.1, isSpeech: false },
      { probability: 0.1, isSpeech: false },
      { probability: 0.93, isSpeech: true },
    ]);
    const onSpeechStart = jest.fn();
    const vad = createVad(
      { onSpeechStart, onSpeechEnd: jest.fn() },
      {
        preferNativeTenVad: true,
        minSpeechFrames: 1,
        nativeTenVadCalibrationFrames: 4,
        nativeTenVadNoiseMarginDb: 3,
      },
    );

    vad.processFrame(-72, new Uint8Array(512));
    await flushPromises();
    vad.processFrame(-71, new Uint8Array(512));
    await flushPromises();
    vad.processFrame(-70, new Uint8Array(512));
    await flushPromises();
    vad.processFrame(-71, new Uint8Array(512));
    await flushPromises();
    vad.processFrame(-52, new Uint8Array(512));
    await flushPromises();

    expect(onSpeechStart).toHaveBeenCalledTimes(1);
  });

  it("raises the TEN VAD energy floor on noisy emulator startup", async () => {
    mockNativeTenVad.processPcm16.mockResolvedValue([
      { probability: 0.92, isSpeech: true },
      { probability: 0.91, isSpeech: true },
      { probability: 0.9, isSpeech: true },
      { probability: 0.89, isSpeech: true },
      { probability: 0.88, isSpeech: true },
    ]);
    const onSpeechStart = jest.fn();
    const vad = createVad(
      { onSpeechStart, onSpeechEnd: jest.fn() },
      {
        preferNativeTenVad: true,
        minSpeechFrames: 1,
        positiveSpeechThreshold: -40,
        nativeTenVadCalibrationFrames: 4,
        nativeTenVadNoiseMarginDb: 3,
      },
    );

    vad.processFrame(-52, new Uint8Array(512));
    await flushPromises();
    vad.processFrame(-51, new Uint8Array(512));
    await flushPromises();
    vad.processFrame(-52, new Uint8Array(512));
    await flushPromises();
    vad.processFrame(-51, new Uint8Array(512));
    await flushPromises();
    vad.processFrame(-52, new Uint8Array(512));
    await flushPromises();

    expect(onSpeechStart).not.toHaveBeenCalled();
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

  it("uses TEN VAD WebAssembly for web PCM frames when TEN VAD is enabled", async () => {
    mockPlatform.OS = "web";
    mockWebTenVad.processPcm16.mockResolvedValue([
      { probability: 0.91, isSpeech: true },
    ]);
    const onSpeechStart = jest.fn();
    const vad = createVad(
      { onSpeechStart, onSpeechEnd: jest.fn() },
      {
        preferNativeTenVad: true,
        minSpeechFrames: 1,
        tenVadThreshold: 0.6,
        tenVadHopSize: 256,
        nativeTenVadCalibrationFrames: 0,
      },
    );
    const pcm = new Uint8Array(512);

    vad.processFrame(-52, pcm);
    await flushPromises();

    expect(mockCreateWebTenVad).toHaveBeenCalledWith({
      hopSize: 256,
      threshold: 0.6,
    });
    expect(mockWebTenVad.create).toHaveBeenCalledTimes(1);
    expect(mockWebTenVad.processPcm16).toHaveBeenCalledWith(
      Buffer.from(pcm).toString("base64"),
    );
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
  });
});
