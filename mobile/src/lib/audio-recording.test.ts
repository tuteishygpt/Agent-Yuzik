const mockStream = {
  init: jest.fn(),
  start: jest.fn(),
  stop: jest.fn().mockResolvedValue(""),
  on: jest.fn(),
};

const mockRequestPermission = jest.fn();

jest.mock("react-native-live-audio-stream", () => ({
  __esModule: true,
  default: mockStream,
}));

import { PermissionsAndroid, Platform } from "react-native";

import { createVoiceRecorderAdapter } from "./audio-recording";

describe("audio recording adapter (native PCM stream)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, "OS", {
      configurable: true,
      value: "android",
    });
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO = "android.permission.RECORD_AUDIO";
    PermissionsAndroid.RESULTS.GRANTED = "granted";
    PermissionsAndroid.RESULTS.DENIED = "denied";
    PermissionsAndroid.request = mockRequestPermission;
    mockRequestPermission.mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
    mockStream.stop.mockResolvedValue("");
  });

  it("initializes the stream with correct PCM config", async () => {
    const adapter = createVoiceRecorderAdapter();
    await adapter.prepare();

    expect(mockRequestPermission).toHaveBeenCalledWith(
      "android.permission.RECORD_AUDIO",
    );

    await adapter.start();

    expect(mockStream.init).toHaveBeenCalledWith({
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      audioSource: 6,
    });
  });

  it("starts streaming and collects PCM chunks", async () => {
    const adapter = createVoiceRecorderAdapter();
    const onMetering = jest.fn();

    await adapter.prepare();
    await adapter.start(onMetering);

    expect(mockStream.on).toHaveBeenCalledWith("data", expect.any(Function));
    expect(mockStream.start).toHaveBeenCalled();

    // Simulate a PCM chunk (silence: all zeros, 160 samples = 320 bytes)
    const dataCallback = mockStream.on.mock.calls[0][1] as (d: string) => void;
    const silentPcm = Buffer.alloc(320, 0).toString("base64");
    dataCallback(silentPcm);

    expect(onMetering).toHaveBeenCalledWith(-160, new Uint8Array(Buffer.alloc(320)));
  });

  it("does not start streaming when microphone permission is denied", async () => {
    mockRequestPermission.mockResolvedValue("denied");
    const adapter = createVoiceRecorderAdapter();

    await expect(adapter.prepare()).rejects.toThrow(
      "Microphone permission is required to start voice recording.",
    );

    expect(mockStream.init).not.toHaveBeenCalled();
    expect(mockStream.start).not.toHaveBeenCalled();
  });

  it("stop assembles WAV from PCM chunks", async () => {
    const adapter = createVoiceRecorderAdapter();
    await adapter.prepare();
    await adapter.start();

    const dataCallback = mockStream.on.mock.calls[0][1] as (d: string) => void;
    const pcm = Buffer.alloc(320, 0x40);
    dataCallback(pcm.toString("base64"));

    const result = await adapter.stop();

    expect(result.wavBytes).not.toBeNull();
    expect(result.wavBytes!.byteLength).toBe(44 + 320);
    expect(result.wavBytes![0]).toBe(0x52); // 'R'
    expect(result.wavBytes![1]).toBe(0x49); // 'I'
    expect(result.wavBytes![2]).toBe(0x46); // 'F'
    expect(result.wavBytes![3]).toBe(0x46); // 'F'
  });

  it("stop returns recorded bytes even when the native stop promise never resolves", async () => {
    mockStream.stop.mockReturnValue(new Promise(() => {}) as never);
    const adapter = createVoiceRecorderAdapter();
    await adapter.prepare();
    await adapter.start();

    const dataCallback = mockStream.on.mock.calls[0][1] as (d: string) => void;
    const pcm = Buffer.alloc(320, 0x40);
    dataCallback(pcm.toString("base64"));

    const result = await adapter.stop();

    expect(mockStream.stop).toHaveBeenCalled();
    expect(result.wavBytes).not.toBeNull();
    expect(result.wavBytes!.byteLength).toBe(44 + 320);
  });

  it("stop returns null if not recording", async () => {
    const adapter = createVoiceRecorderAdapter();
    const result = await adapter.stop();
    expect(result).toEqual({ uri: null, wavBytes: null });
  });
});
