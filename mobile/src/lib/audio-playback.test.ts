import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";

jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache",
  EncodingType: {
    Base64: "base64",
  },
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

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
const mockCreateAudioPlayerWeb = jest.fn(() => mockPlayer);
const mockAudioModuleDefault: {
  AudioPlayer?: typeof mockCreateAudioPlayer;
  AudioPlayerWeb?: typeof mockCreateAudioPlayerWeb;
} = {
  AudioPlayer: mockCreateAudioPlayer,
};
const mockAudioModuleExports: {
  default?: typeof mockAudioModuleDefault;
  AudioPlayerWeb?: typeof mockCreateAudioPlayerWeb;
} = {
  default: mockAudioModuleDefault,
};

jest.mock("expo-audio/build/AudioModule", () => ({
  __esModule: true,
  get default() {
    return mockAudioModuleExports.default;
  },
  get AudioPlayerWeb() {
    return mockAudioModuleExports.AudioPlayerWeb;
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

function createLocalPcmFrameOfLength(
  sampleCount: number,
  sample = 0.1,
): Uint8Array {
  const frame = new Uint8Array(8 + sampleCount * 4);
  frame.set([0x50, 0x43, 0x4d, 0x00], 0);

  const view = new DataView(frame.buffer);
  view.setUint32(4, sampleCount, true);
  for (let index = 0; index < sampleCount; index++) {
    view.setFloat32(8 + index * 4, sample, true);
  }

  return frame;
}

describe("audio playback adapter", () => {
  const originalNavigator = global.navigator;
  const originalAudio = global.Audio;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPlaybackStatusListener = null;
    mockAudioModuleExports.default = mockAudioModuleDefault;
    delete mockAudioModuleExports.AudioPlayerWeb;
    mockAudioModuleDefault.AudioPlayer = mockCreateAudioPlayer;
    delete mockAudioModuleDefault.AudioPlayerWeb;
    Object.defineProperty(global, "navigator", {
      configurable: true,
      value: originalNavigator,
    });
    Object.defineProperty(global, "Audio", {
      configurable: true,
      value: originalAudio,
    });
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

  it("plays cached response audio through expo-audio on web", async () => {
    delete mockAudioModuleDefault.AudioPlayer;
    mockAudioModuleDefault.AudioPlayerWeb = mockCreateAudioPlayerWeb;
    const writeBytesToCache = jest
      .fn()
      .mockResolvedValue("file:///cache/yuzik-voice-response.wav");
    const playback = createVoicePlaybackAdapter({
      writeBytesToCache,
    });

    await playback.playBytes(new Uint8Array([1, 2, 3]));

    expect(mockCreateAudioPlayerWeb).toHaveBeenCalledWith(
      { uri: "file:///cache/yuzik-voice-response.wav" },
      { updateInterval: 500 },
    );
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    expect(playback.isPlaying()).toBe(true);
  });

  it("uses named AudioPlayerWeb when the web module has no default export", async () => {
    delete mockAudioModuleExports.default;
    mockAudioModuleExports.AudioPlayerWeb = mockCreateAudioPlayerWeb;
    const writeBytesToCache = jest
      .fn()
      .mockResolvedValue("blob:yuzik-response");
    const playback = createVoicePlaybackAdapter({
      writeBytesToCache,
    });

    await playback.playBytes(new Uint8Array([1, 2, 3]));

    expect(mockCreateAudioPlayerWeb).toHaveBeenCalledWith(
      { uri: "blob:yuzik-response" },
      { updateInterval: 500 },
    );
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  });

  it("does not send browser data URIs through native file cleanup", async () => {
    const deleteAsync = FileSystem.deleteAsync as jest.MockedFunction<
      typeof FileSystem.deleteAsync
    >;
    const createSound = jest.fn(
      async (_uri: string, onFinished: () => void) => ({
        play: () => onFinished(),
        pause: jest.fn(),
        remove: jest.fn(),
      }),
    );
    const playback = createVoicePlaybackAdapter({
      createSound,
      writeBytesToCache: jest
        .fn()
        .mockResolvedValue("data:audio/wav;base64,UklGRg=="),
    });

    await playback.playBytes(new Uint8Array([1, 2, 3]));
    await flushPromises();

    expect(deleteAsync).not.toHaveBeenCalled();
  });

  it("uses a browser blob URL for web response audio bytes", async () => {
    const originalPlatform = Platform.OS;
    const originalAudioContext = global.AudioContext;
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const createObjectURL = jest.fn(() => "blob:yuzik-response");
    const revokeObjectURL = jest.fn();
    const source = {
      buffer: null as unknown,
      connect: jest.fn(),
      start: jest.fn(function start() {
        source.onended?.();
      }),
      stop: jest.fn(),
      disconnect: jest.fn(),
      onended: null as null | (() => void),
    };
    const audioContext = {
      state: "running",
      destination: {},
      currentTime: 0,
      sampleRate: 48000,
      resume: jest.fn().mockResolvedValue(undefined),
      decodeAudioData: jest.fn().mockResolvedValue({ duration: 0.2 }),
      createBuffer: jest.fn(() => ({ duration: 0 })),
      createBufferSource: jest.fn(() => source),
    };

    Object.defineProperty(Platform, "OS", {
      configurable: true,
      value: "web",
    });
    Object.defineProperty(global, "AudioContext", {
      configurable: true,
      value: jest.fn(() => audioContext),
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    delete mockAudioModuleDefault.AudioPlayer;
    mockAudioModuleDefault.AudioPlayerWeb = mockCreateAudioPlayerWeb;

    try {
      const playback = createVoicePlaybackAdapter();

      await playback.playBytes(new Uint8Array([1, 2, 3]));

      expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      expect(audioContext.decodeAudioData).toHaveBeenCalled();
      expect(source.start).toHaveBeenCalledTimes(1);
      expect(mockCreateAudioPlayerWeb).not.toHaveBeenCalled();

      mockPlaybackStatusListener?.({ didJustFinish: true, isLoaded: true });
      await flushPromises();

      expect(revokeObjectURL).toHaveBeenCalledWith("blob:yuzik-response");
    } finally {
      Object.defineProperty(Platform, "OS", {
        configurable: true,
        value: originalPlatform,
      });
      Object.defineProperty(global, "AudioContext", {
        configurable: true,
        value: originalAudioContext,
      });
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: originalCreateObjectUrl,
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: originalRevokeObjectUrl,
      });
    }
  });

  it("plays browser response audio through an unlocked Web Audio context", async () => {
    const originalPlatform = Platform.OS;
    const originalAudioContext = global.AudioContext;
    const source = {
      buffer: null as unknown,
      connect: jest.fn(),
      start: jest.fn(function start() {
        source.onended?.();
      }),
      stop: jest.fn(),
      disconnect: jest.fn(),
      onended: null as null | (() => void),
    };
    const audioContext = {
      state: "running",
      destination: {},
      currentTime: 0,
      resume: jest.fn().mockResolvedValue(undefined),
      decodeAudioData: jest.fn().mockResolvedValue({ duration: 0.2 }),
      createBuffer: jest.fn(() => ({ duration: 0 })),
      createBufferSource: jest.fn(() => source),
    };

    Object.defineProperty(Platform, "OS", {
      configurable: true,
      value: "web",
    });
    Object.defineProperty(global, "AudioContext", {
      configurable: true,
      value: jest.fn(() => audioContext),
    });

    try {
      const playback = createVoicePlaybackAdapter({
        writeBytesToCache: jest.fn().mockResolvedValue("blob:yuzik-response"),
      });

      playback.prepare?.();
      await playback.playBytes(new Uint8Array([1, 2, 3]));

      expect(audioContext.resume).toHaveBeenCalled();
      expect(audioContext.decodeAudioData).toHaveBeenCalled();
      expect(source.connect).toHaveBeenCalledWith(audioContext.destination);
      expect(source.start).toHaveBeenCalledTimes(2);
      expect(mockCreateAudioPlayerWeb).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(Platform, "OS", {
        configurable: true,
        value: originalPlatform,
      });
      Object.defineProperty(global, "AudioContext", {
        configurable: true,
        value: originalAudioContext,
      });
    }
  });

  it("plays local PCM frames on web without browser WAV decoding", async () => {
    const originalPlatform = Platform.OS;
    const originalAudioContext = global.AudioContext;
    const channelData = { set: jest.fn() };
    const source = {
      buffer: null as unknown,
      connect: jest.fn(),
      start: jest.fn(function start() {
        source.onended?.();
      }),
      stop: jest.fn(),
      disconnect: jest.fn(),
      onended: null as null | (() => void),
    };
    const audioContext = {
      state: "running",
      destination: {},
      currentTime: 1,
      sampleRate: 48000,
      resume: jest.fn().mockResolvedValue(undefined),
      decodeAudioData: jest.fn(),
      createBuffer: jest.fn(() => ({
        duration: 2 / 24000,
        getChannelData: jest.fn(() => channelData),
      })),
      createBufferSource: jest.fn(() => source),
    };
    const writeBytesToCache = jest.fn();

    Object.defineProperty(Platform, "OS", {
      configurable: true,
      value: "web",
    });
    Object.defineProperty(global, "AudioContext", {
      configurable: true,
      value: jest.fn(() => audioContext),
    });

    try {
      const playback = createVoicePlaybackAdapter({
        nativePcm: null,
        writeBytesToCache,
      });

      await playback.playBytes(createLocalPcmFrame([0.25, -0.5]), {
        sampleRate: 24000,
        playbackMinBufferMs: 1200,
      });

      expect(writeBytesToCache).not.toHaveBeenCalled();
      expect(audioContext.decodeAudioData).not.toHaveBeenCalled();
      expect(audioContext.createBuffer).toHaveBeenCalledWith(1, 2, 24000);
      expect(channelData.set).toHaveBeenCalledWith(
        new Float32Array([0.25, -0.5]),
      );
      expect(source.connect).toHaveBeenCalledWith(audioContext.destination);
      expect(source.start).toHaveBeenCalledWith(2.2);
    } finally {
      Object.defineProperty(Platform, "OS", {
        configurable: true,
        value: originalPlatform,
      });
      Object.defineProperty(global, "AudioContext", {
        configurable: true,
        value: originalAudioContext,
      });
    }
  });

  it("resumes an interrupted browser audio context before playing local PCM", async () => {
    const originalPlatform = Platform.OS;
    const originalAudioContext = global.AudioContext;
    const channelData = { set: jest.fn() };
    const source = {
      buffer: null as unknown,
      connect: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
      disconnect: jest.fn(),
      onended: null as null | (() => void),
    };
    const audioContext = {
      state: "interrupted",
      destination: {},
      currentTime: 1,
      sampleRate: 48000,
      resume: jest.fn().mockImplementation(() => {
        audioContext.state = "running";
        return Promise.resolve();
      }),
      decodeAudioData: jest.fn(),
      createBuffer: jest.fn(() => ({
        duration: 2 / 24000,
        getChannelData: jest.fn(() => channelData),
      })),
      createBufferSource: jest.fn(() => source),
    };

    Object.defineProperty(Platform, "OS", {
      configurable: true,
      value: "web",
    });
    Object.defineProperty(global, "AudioContext", {
      configurable: true,
      value: jest.fn(() => audioContext),
    });

    try {
      const playback = createVoicePlaybackAdapter({
        nativePcm: null,
        writeBytesToCache: jest.fn(),
      });

      await playback.playBytes(createLocalPcmFrame([0.25, -0.5]), {
        sampleRate: 24000,
      });

      expect(audioContext.resume).toHaveBeenCalledTimes(1);
      expect(source.start).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(Platform, "OS", {
        configurable: true,
        value: originalPlatform,
      });
      Object.defineProperty(global, "AudioContext", {
        configurable: true,
        value: originalAudioContext,
      });
    }
  });

  it("uses HTML audio WAV playback for local PCM on iOS Safari web", async () => {
    jest.useFakeTimers();
    const originalPlatform = Platform.OS;
    const originalAudioContext = global.AudioContext;
    const audioSessionTypes: string[] = [];
    const audioSession = {
      get type() {
        return audioSessionTypes[audioSessionTypes.length - 1] ?? "auto";
      },
      set type(value: string) {
        audioSessionTypes.push(value);
      },
    };
    const audio = {
      src: "",
      preload: "",
      playsInline: false,
      currentTime: 0,
      onended: null as null | (() => void),
      onerror: null as null | (() => void),
      load: jest.fn(),
      play: jest.fn().mockResolvedValue(undefined),
      pause: jest.fn(),
      removeAttribute: jest.fn(),
    };
    const AudioCtor = jest.fn(() => audio);
    const writeBytesToCache = jest
      .fn()
      .mockResolvedValue("blob:yuzik-ios-response");

    Object.defineProperty(Platform, "OS", {
      configurable: true,
      value: "web",
    });
    Object.defineProperty(global, "navigator", {
      configurable: true,
      value: {
        audioSession,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
        platform: "iPhone",
        maxTouchPoints: 5,
      },
    });
    Object.defineProperty(global, "Audio", {
      configurable: true,
      value: AudioCtor,
    });
    Object.defineProperty(global, "AudioContext", {
      configurable: true,
      value: jest.fn(),
    });

    try {
      const playback = createVoicePlaybackAdapter({
        nativePcm: null,
        writeBytesToCache,
      });

      playback.prepare();
      const started = playback.playBytes(createLocalPcmFrame([0.25, -0.5]), {
        sampleRate: 24000,
      });

      await Promise.resolve();
      expect(writeBytesToCache).not.toHaveBeenCalled();

      jest.advanceTimersByTime(399);
      await Promise.resolve();
      await Promise.resolve();
      expect(writeBytesToCache).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
      await started;

      expect(AudioCtor).toHaveBeenCalledTimes(1);
      expect(global.AudioContext).not.toHaveBeenCalled();
      expect(writeBytesToCache).toHaveBeenCalledTimes(1);
      const cachedBytes = writeBytesToCache.mock.calls[0][0] as Uint8Array;
      expect(String.fromCharCode(...cachedBytes.slice(0, 4))).toBe("RIFF");
      expect(audio.src).toBe("blob:yuzik-ios-response");
      expect(audio.play).toHaveBeenCalledTimes(2);
      expect(audioSessionTypes).toEqual(["playback", "playback"]);
    } finally {
      Object.defineProperty(Platform, "OS", {
        configurable: true,
        value: originalPlatform,
      });
      Object.defineProperty(global, "AudioContext", {
        configurable: true,
        value: originalAudioContext,
      });
      jest.useRealTimers();
    }
  });

  it("does not let delayed iOS Safari audio priming pause real playback", async () => {
    const originalPlatform = Platform.OS;
    const originalAudio = global.Audio;
    let resolvePrimePlay!: () => void;
    const audio = {
      src: "",
      preload: "",
      playsInline: false,
      currentTime: 0,
      onended: null as null | (() => void),
      onerror: null as null | (() => void),
      load: jest.fn(),
      play: jest
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              resolvePrimePlay = resolve;
            }),
        )
        .mockResolvedValueOnce(undefined),
      pause: jest.fn(),
      removeAttribute: jest.fn(),
    };
    const AudioCtor = jest.fn(() => audio);

    Object.defineProperty(Platform, "OS", {
      configurable: true,
      value: "web",
    });
    Object.defineProperty(global, "navigator", {
      configurable: true,
      value: {
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
        platform: "iPhone",
        maxTouchPoints: 5,
      },
    });
    Object.defineProperty(global, "Audio", {
      configurable: true,
      value: AudioCtor,
    });

    try {
      const playback = createVoicePlaybackAdapter({
        nativePcm: null,
        writeBytesToCache: jest.fn().mockResolvedValue("blob:yuzik-response"),
      });

      playback.prepare();
      const started = playback.playBytes(new Uint8Array([1, 2, 3]));

      await Promise.resolve();
      await Promise.resolve();
      await started;
      expect(audio.src).toBe("blob:yuzik-response");

      resolvePrimePlay();
      await Promise.resolve();

      expect(audio.pause).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(Platform, "OS", {
        configurable: true,
        value: originalPlatform,
      });
      Object.defineProperty(global, "Audio", {
        configurable: true,
        value: originalAudio,
      });
    }
  });

  it("keeps a large iOS Safari PCM response in one HTML audio blob until stream idle", async () => {
    jest.useFakeTimers();
    const originalPlatform = Platform.OS;
    const originalAudioContext = global.AudioContext;
    const audio = {
      src: "",
      preload: "",
      playsInline: false,
      currentTime: 0,
      onended: null as null | (() => void),
      onerror: null as null | (() => void),
      load: jest.fn(),
      play: jest.fn().mockResolvedValue(undefined),
      pause: jest.fn(),
      removeAttribute: jest.fn(),
    };
    const AudioCtor = jest.fn(() => audio);
    const writeBytesToCache = jest
      .fn()
      .mockResolvedValue("blob:yuzik-ios-response");
    const onDebug = jest.fn();

    Object.defineProperty(Platform, "OS", {
      configurable: true,
      value: "web",
    });
    Object.defineProperty(global, "navigator", {
      configurable: true,
      value: {
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
        platform: "iPhone",
        maxTouchPoints: 5,
      },
    });
    Object.defineProperty(global, "Audio", {
      configurable: true,
      value: AudioCtor,
    });
    Object.defineProperty(global, "AudioContext", {
      configurable: true,
      value: jest.fn(),
    });

    try {
      const playback = createVoicePlaybackAdapter({
        nativePcm: null,
        writeBytesToCache,
      });

      const firstStarted = playback.playBytes(
        createLocalPcmFrameOfLength(70_000, 0.1),
        { sampleRate: 24000, onDebug },
      );
      const secondStarted = playback.playBytes(
        createLocalPcmFrameOfLength(70_000, 0.2),
        { sampleRate: 24000, onDebug },
      );

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(writeBytesToCache).not.toHaveBeenCalled();

      jest.advanceTimersByTime(399);
      await Promise.resolve();
      await Promise.resolve();

      expect(writeBytesToCache).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
      await firstStarted;
      await secondStarted;

      expect(writeBytesToCache).toHaveBeenCalledTimes(1);
      expect(onDebug).toHaveBeenCalledTimes(1);
      expect(onDebug).toHaveBeenCalledWith({
        type: "web_html_start",
        bytes: expect.any(Number),
      });
      const cachedBytes = writeBytesToCache.mock.calls[0][0] as Uint8Array;
      const view = new DataView(
        cachedBytes.buffer,
        cachedBytes.byteOffset,
        cachedBytes.byteLength,
      );

      expect(String.fromCharCode(...cachedBytes.slice(0, 4))).toBe("RIFF");
      expect(view.getUint32(40, true)).toBe(560_000);
      expect(view.getFloat32(44, true)).toBeCloseTo(0.1);
      expect(view.getFloat32(44 + 70_000 * 4, true)).toBeCloseTo(0.2);

      audio.onended?.();
      await Promise.resolve();
      expect(onDebug).toHaveBeenLastCalledWith({ type: "web_html_end" });
    } finally {
      Object.defineProperty(Platform, "OS", {
        configurable: true,
        value: originalPlatform,
      });
      Object.defineProperty(global, "AudioContext", {
        configurable: true,
        value: originalAudioContext,
      });
      jest.useRealTimers();
    }
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
      playbackMinBufferMs: 420,
    });

    expect(nativePcm.pushFloat32Pcm).toHaveBeenCalledTimes(1);
    expect(nativePcm.pushFloat32Pcm).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      24000,
      420,
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
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(120);
    await Promise.resolve();
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
