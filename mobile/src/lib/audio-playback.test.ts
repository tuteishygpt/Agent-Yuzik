const mockPlayer = {
  addListener: jest.fn((_eventName: string, listener: (status: { didJustFinish?: boolean; isLoaded?: boolean }) => void) => {
    mockPlaybackStatusListener = listener;
    return { remove: mockRemoveListener };
  }),
  play: jest.fn(),
  pause: jest.fn(),
  remove: jest.fn(),
};

let mockPlaybackStatusListener:
  | ((status: { didJustFinish?: boolean; isLoaded?: boolean }) => void)
  | null = null;
const mockRemoveListener = jest.fn();
const mockCreateAudioPlayer = jest.fn(() => mockPlayer);

jest.mock("expo-audio/build/AudioModule", () => ({
  __esModule: true,
  default: {
    AudioPlayer: mockCreateAudioPlayer,
  },
}));

import { createVoicePlaybackAdapter } from "./audio-playback";

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createLocalPcmFrame(samples: number[]): Uint8Array {
  const frame = new Uint8Array(8 + samples.length * 4);
  frame.set([0x50, 0x43, 0x4d, 0x00], 0);

  const view = new DataView(frame.buffer);
  view.setUint32(4, samples.length, true);
  samples.forEach((sample, index) => {
    view.setFloat32(8 + index * 4, sample, true);
  });

  return frame;
}

describe("audio playback adapter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPlaybackStatusListener = null;
  });

  it("plays cached response audio through expo-audio", async () => {
    const writeBytesToCache = jest
      .fn()
      .mockResolvedValue("file:///cache/yuzik-voice-response.wav");
    const playback = createVoicePlaybackAdapter({
      writeBytesToCache,
    });

    await playback.playBytes(new Uint8Array([1, 2, 3]));

    expect(writeBytesToCache).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3]),
      null,
    );
    expect(mockCreateAudioPlayer).toHaveBeenCalledWith(
      { uri: "file:///cache/yuzik-voice-response.wav" },
      500,
      false,
    );
    expect(mockPlayer.addListener).toHaveBeenCalledWith(
      "playbackStatusUpdate",
      expect.any(Function),
    );
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    expect(playback.isPlaying()).toBe(true);
  });

  it("wraps local PCM response frames in a playable WAV container before caching", async () => {
    const writeBytesToCache = jest
      .fn()
      .mockResolvedValue("file:///cache/yuzik-voice-response.wav");
    const playback = createVoicePlaybackAdapter({
      writeBytesToCache,
    });

    await playback.playBytes(createLocalPcmFrame([0.25, -0.25]), {
      sampleRate: 24000,
    });

    const cachedBytes = writeBytesToCache.mock.calls[0][0] as Uint8Array;
    const view = new DataView(
      cachedBytes.buffer,
      cachedBytes.byteOffset,
      cachedBytes.byteLength,
    );

    expect(String.fromCharCode(...cachedBytes.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...cachedBytes.slice(8, 12))).toBe("WAVE");
    expect(view.getUint16(20, true)).toBe(3);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint16(34, true)).toBe(32);
    expect(String.fromCharCode(...cachedBytes.slice(36, 40))).toBe("data");
    expect(view.getUint32(40, true)).toBe(8);
  });

  it("streams local PCM response frames through native playback when available", async () => {
    const nativePcm = {
      isAvailable: jest.fn(() => true),
      pushFloat32Pcm: jest.fn().mockResolvedValue(undefined),
      reset: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
    };
    const writeBytesToCache = jest.fn();
    const playback = createVoicePlaybackAdapter({
      nativePcm,
      writeBytesToCache,
    });

    await playback.playBytes(createLocalPcmFrame([0.1, 0.2]), {
      sampleRate: 24000,
    });

    expect(nativePcm.pushFloat32Pcm).toHaveBeenCalledTimes(1);
    expect(nativePcm.pushFloat32Pcm).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      24000,
    );
    const pushedBytes = nativePcm.pushFloat32Pcm.mock.calls[0][0] as Uint8Array;
    const view = new DataView(
      pushedBytes.buffer,
      pushedBytes.byteOffset,
      pushedBytes.byteLength,
    );

    expect(pushedBytes.byteLength).toBe(8);
    expect(view.getFloat32(0, true)).toBeCloseTo(0.1);
    expect(view.getFloat32(4, true)).toBeCloseTo(0.2);
    expect(writeBytesToCache).not.toHaveBeenCalled();
  });

  it("falls back to coalesced WAV playback when native PCM streaming fails", async () => {
    jest.useFakeTimers();

    const nativePcm = {
      isAvailable: jest.fn(() => true),
      pushFloat32Pcm: jest
        .fn()
        .mockRejectedValueOnce(new Error("native unavailable")),
      reset: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
    };
    const writeBytesToCache = jest
      .fn()
      .mockResolvedValue("file:///cache/fallback.wav");
    const playback = createVoicePlaybackAdapter({
      nativePcm,
      writeBytesToCache,
    });

    const started = playback.playBytes(createLocalPcmFrame([0.3]), {
      sampleRate: 24000,
    });

    await Promise.resolve();
    jest.advanceTimersByTime(120);
    await Promise.resolve();
    await Promise.resolve();
    await started;

    expect(nativePcm.pushFloat32Pcm).toHaveBeenCalledTimes(1);
    expect(writeBytesToCache).toHaveBeenCalledTimes(1);
    const cachedBytes = writeBytesToCache.mock.calls[0][0] as Uint8Array;
    const view = new DataView(
      cachedBytes.buffer,
      cachedBytes.byteOffset,
      cachedBytes.byteLength,
    );

    expect(String.fromCharCode(...cachedBytes.slice(0, 4))).toBe("RIFF");
    expect(view.getFloat32(44, true)).toBeCloseTo(0.3);

    jest.useRealTimers();
  });

  it("stops native PCM playback when playback is stopped or released", () => {
    const nativePcm = {
      isAvailable: jest.fn(() => true),
      pushFloat32Pcm: jest.fn().mockResolvedValue(undefined),
      reset: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
    };
    const playback = createVoicePlaybackAdapter({ nativePcm });

    playback.stop();
    playback.release();

    expect(nativePcm.stop).toHaveBeenCalledTimes(2);
    expect(nativePcm.reset).toHaveBeenCalledTimes(2);
  });

  it("queues streamed response chunks instead of unloading the current sound", async () => {
    const finishers: Array<() => void> = [];
    const sounds = [
      {
        play: jest.fn(),
        pause: jest.fn(),
        remove: jest.fn(),
      },
      {
        play: jest.fn(),
        pause: jest.fn(),
        remove: jest.fn(),
      },
    ];
    const writeBytesToCache = jest
      .fn()
      .mockResolvedValueOnce("file:///cache/chunk-1.wav")
      .mockResolvedValueOnce("file:///cache/chunk-2.wav");
    const createSound = jest.fn(
      async (_uri: string, onFinished: () => void) => {
        finishers.push(onFinished);
        return sounds[finishers.length - 1];
      },
    );
    const playback = createVoicePlaybackAdapter({
      createSound,
      writeBytesToCache,
    });

    const firstStarted = playback.playBytes(new Uint8Array([1]));
    const secondStarted = playback.playBytes(new Uint8Array([2]));
    await firstStarted;
    await flushPromises();

    expect(sounds[0].play).toHaveBeenCalledTimes(1);
    expect(sounds[0].pause).not.toHaveBeenCalled();
    expect(sounds[0].remove).not.toHaveBeenCalled();
    expect(sounds[1].play).not.toHaveBeenCalled();

    finishers[0]();
    await secondStarted;

    expect(sounds[0].remove).toHaveBeenCalledTimes(1);
    expect(sounds[1].play).toHaveBeenCalledTimes(1);
  });

  it("coalesces local PCM stream chunks before creating a WAV sound", async () => {
    jest.useFakeTimers();

    const writeBytesToCache = jest
      .fn()
      .mockResolvedValue("file:///cache/coalesced.wav");
    const playback = createVoicePlaybackAdapter({
      writeBytesToCache,
    });

    const firstStarted = playback.playBytes(createLocalPcmFrame([0.1]), {
      sampleRate: 24000,
    });
    const secondStarted = playback.playBytes(createLocalPcmFrame([0.2]), {
      sampleRate: 24000,
    });

    await Promise.resolve();
    expect(writeBytesToCache).not.toHaveBeenCalled();

    jest.advanceTimersByTime(120);
    await Promise.resolve();
    await Promise.resolve();
    await firstStarted;
    await secondStarted;

    expect(writeBytesToCache).toHaveBeenCalledTimes(1);
    const cachedBytes = writeBytesToCache.mock.calls[0][0] as Uint8Array;
    const view = new DataView(
      cachedBytes.buffer,
      cachedBytes.byteOffset,
      cachedBytes.byteLength,
    );

    expect(String.fromCharCode(...cachedBytes.slice(0, 4))).toBe("RIFF");
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getFloat32(44, true)).toBeCloseTo(0.1);
    expect(view.getFloat32(48, true)).toBeCloseTo(0.2);

    jest.useRealTimers();
  });
});
