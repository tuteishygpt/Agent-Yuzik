import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

import {
  createNativePcmPlayer,
  type NativePcmPlayer,
} from "./native-pcm-player";
import {
  bytesToBase64,
  DEFAULT_LOCAL_PCM_SAMPLE_RATE,
  isLocalPcmFrame,
  LOCAL_PCM_FRAME_HEADER_SIZE,
  normalizePlaybackBytes,
} from "./audio-pcm-format";
import { createPcmBuffer } from "./audio-pcm-buffer";

export type VoicePlaybackAdapter = {
  prepare: () => void;
  playBytes: (
    bytes: Uint8Array,
    options?: VoicePlaybackBytesOptions,
  ) => Promise<void>;
  stop: () => void;
  release: () => void;
  isPlaying: () => boolean;
};

export type VoicePlaybackDebugEvent =
  | {
      type: "web_pcm_schedule";
      contextStateBefore: string;
      contextStateAfter: string;
      contextSampleRate: number;
      frameSampleRate: number;
      samples: number;
      rmsDb: number;
      peak: number;
      currentTime: number;
      startAt: number;
      queueEndAt: number;
      minBufferMs: number;
    }
  | {
      type: "web_pcm_end";
      contextState: string;
      currentTime: number;
      remainingSources: number;
    }
  | {
      type: "web_html_start";
      bytes: number;
    }
  | {
      type: "web_html_end";
    };

export type VoicePlaybackBytesOptions = {
  sampleRate?: number;
  playbackMinBufferMs?: number;
  onDebug?: (event: VoicePlaybackDebugEvent) => void;
};

type VoicePlaybackSound = {
  play: () => void | Promise<void>;
  pause: () => void;
  remove: () => void;
};

type VoicePlaybackOptions = {
  nativePcm?: NativePcmPlayer | null;
  createSound?: (
    uri: string,
    onFinished: () => void,
    bytes: Uint8Array,
  ) => Promise<VoicePlaybackSound>;
  cacheDirectory?: string | null;
  writeBytesToCache?: (
    bytes: Uint8Array,
    cacheDirectory: string | null,
  ) => Promise<string>;
};

function ignorePlaybackCleanup(promise: Promise<unknown> | undefined): void {
  void promise?.catch(() => undefined);
}

function ignorePlaybackCleanupSync(cleanup: (() => void) | undefined): void {
  try {
    cleanup?.();
  } catch {
    // Playback cleanup must not interrupt stop/release paths.
  }
}

let cacheFileCounter = 0;

async function writeBytesToCache(
  bytes: Uint8Array,
  cacheDirectory: string | null,
): Promise<string> {
  if (Platform.OS === "web") {
    if (
      typeof Blob === "undefined" ||
      typeof URL === "undefined" ||
      typeof URL.createObjectURL !== "function"
    ) {
      throw new Error("Browser audio blob URLs are unavailable.");
    }

    const blobBytes = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(blobBytes).set(bytes);
    return URL.createObjectURL(new Blob([blobBytes], { type: "audio/wav" }));
  }

  const directory = cacheDirectory ?? FileSystem.cacheDirectory;

  if (!directory) {
    throw new Error("File system cache directory is unavailable.");
  }

  cacheFileCounter = (cacheFileCounter + 1) % 4;
  const uri = `${directory.replace(/\/+$/, "")}/yuzik-voice-${cacheFileCounter}.wav`;
  await FileSystem.writeAsStringAsync(uri, bytesToBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });

  return uri;
}

function hasUriScheme(uri: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(uri);
}

function cleanupPlaybackUri(uri: string): void {
  if (
    uri.startsWith("blob:") &&
    typeof URL !== "undefined" &&
    typeof URL.revokeObjectURL === "function"
  ) {
    URL.revokeObjectURL(uri);
    return;
  }

  if (uri.startsWith("file:") || !hasUriScheme(uri)) {
    void FileSystem.deleteAsync(uri, { idempotent: true }).catch(
      () => undefined,
    );
  }
}

function getWebAudioContextConstructor(): typeof AudioContext | undefined {
  const audioGlobal = globalThis as typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };
  return audioGlobal.AudioContext ?? audioGlobal.webkitAudioContext;
}

function isIosWebBrowser(): boolean {
  if (Platform.OS !== "web") {
    return false;
  }

  const navigatorInfo = globalThis.navigator as
    | (Navigator & {
        userAgent?: string;
        platform?: string;
        maxTouchPoints?: number;
      })
    | undefined;
  const userAgent = navigatorInfo?.userAgent ?? "";
  const platform = navigatorInfo?.platform ?? "";

  return (
    /iPad|iPhone|iPod/.test(userAgent) ||
    (platform === "MacIntel" && (navigatorInfo?.maxTouchPoints ?? 0) > 1)
  );
}

function cloneToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function float32PcmBytesToSamples(bytes: Uint8Array): Float32Array {
  const samples = new Float32Array(Math.floor(bytes.byteLength / 4));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let index = 0; index < samples.length; index++) {
    const sample = view.getFloat32(index * 4, true);
    samples[index] = Number.isFinite(sample)
      ? Math.max(-1, Math.min(1, sample))
      : 0;
  }

  return samples;
}

function summarizeFloat32Samples(samples: Float32Array): {
  rmsDb: number;
  peak: number;
} {
  if (samples.length === 0) {
    return { rmsDb: -160, peak: 0 };
  }

  let sumSq = 0;
  let peak = 0;
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index] ?? 0;
    sumSq += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }

  const rms = Math.sqrt(sumSq / samples.length);
  return {
    rmsDb: rms < 1e-10 ? -160 : 20 * Math.log10(rms),
    peak,
  };
}

async function resumeWebAudioContextIfNeeded(
  context: AudioContext,
): Promise<void> {
  if (context.state !== "running") {
    await context.resume();
  }
}

type ExpoPlaybackStatus = {
  didJustFinish?: boolean;
  isLoaded?: boolean;
};

type ExpoPlaybackSound = VoicePlaybackSound & {
  addListener?: (
    eventName: "playbackStatusUpdate",
    listener: (status: ExpoPlaybackStatus) => void,
  ) => { remove: () => void };
};

type ExpoAudioModule = {
  AudioPlayer?: new (
    source: { uri: string },
    updateInterval: number,
    keepAudioSessionActive: boolean,
  ) => ExpoPlaybackSound;
  AudioPlayerWeb?: new (
    source: { uri: string },
    options: { updateInterval: number },
  ) => ExpoPlaybackSound;
};

async function createExpoPlaybackSound(
  uri: string,
  onFinished: () => void,
): Promise<VoicePlaybackSound> {
  const audioModuleExports = require("expo-audio/build/AudioModule") as {
    default?: unknown;
    AudioPlayerWeb?: unknown;
  };
  const audioModule = (audioModuleExports.default ??
    audioModuleExports) as ExpoAudioModule;

  const player = audioModule.AudioPlayer
    ? new audioModule.AudioPlayer({ uri }, 500, false)
    : audioModule.AudioPlayerWeb
      ? new audioModule.AudioPlayerWeb({ uri }, { updateInterval: 500 })
      : null;

  if (!player) {
    throw new Error("Expo audio playback is unavailable.");
  }

  const subscription = player.addListener?.(
    "playbackStatusUpdate",
    (status) => {
      if (status.isLoaded !== false && status.didJustFinish) {
        onFinished();
      }
    },
  );

  return {
    play: () => player.play(),
    pause: () => player.pause(),
    remove: () => {
      subscription?.remove();
      player.remove();
    },
  };
}

function createWebPlaybackBackend(onPlayingChange: (playing: boolean) => void) {
  let webAudioContext: AudioContext | null = null;
  let webHtmlAudioElement: HTMLAudioElement | null = null;
  let webPcmQueueEndAt = 0;
  const webPcmSources = new Set<AudioBufferSourceNode>();

  function getWebAudioContext(): AudioContext {
    if (webAudioContext) {
      return webAudioContext;
    }

    const AudioContextCtor = getWebAudioContextConstructor();
    if (!AudioContextCtor) {
      throw new Error("Browser audio playback is unavailable.");
    }

    webAudioContext = new AudioContextCtor();
    return webAudioContext;
  }

  function getWebHtmlAudioElement(): HTMLAudioElement {
    if (webHtmlAudioElement) {
      return webHtmlAudioElement;
    }

    if (typeof Audio === "undefined") {
      throw new Error("Browser HTML audio playback is unavailable.");
    }

    webHtmlAudioElement = new Audio();
    webHtmlAudioElement.preload = "auto";
    (webHtmlAudioElement as HTMLAudioElement & { playsInline?: boolean })
      .playsInline = true;
    return webHtmlAudioElement;
  }

  function prepareWebHtmlPlayback(): void {
    try {
      const audio = getWebHtmlAudioElement();
      audio.src =
        "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=";
      audio.load?.();
      void audio
        .play()
        .then(() => {
          audio.pause();
          try {
            audio.currentTime = 0;
          } catch {}
        })
        .catch(() => undefined);
    } catch {
      // The real playback call will surface a user-visible error if needed.
    }
  }

  return {
    isIosBrowser: isIosWebBrowser,
    prepare(): void {
      if (Platform.OS !== "web") {
        return;
      }

      if (isIosWebBrowser()) {
        prepareWebHtmlPlayback();
        return;
      }

      try {
        const context = getWebAudioContext();
        void context.resume?.().catch(() => undefined);
        const buffer = context.createBuffer(
          1,
          1,
          Math.max(1, context.sampleRate || DEFAULT_LOCAL_PCM_SAMPLE_RATE),
        );
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.onended = () => {
          try {
            source.disconnect();
          } catch {}
        };
        source.start(0);
      } catch {
        // The real playback call will surface a user-visible error if needed.
      }
    },
    async createSound(
      uri: string,
      onFinished: () => void,
      bytes: Uint8Array,
    ): Promise<VoicePlaybackSound> {
      if (isIosWebBrowser()) {
        return {
          play: async () => {
            const audio = getWebHtmlAudioElement();
            audio.onended = () => onFinished();
            audio.onerror = () => onFinished();
            audio.src = uri;
            audio.load?.();
            await audio.play();
          },
          pause: () => {
            getWebHtmlAudioElement().pause();
          },
          remove: () => {
            const audio = getWebHtmlAudioElement();
            audio.onended = null;
            audio.onerror = null;
            audio.pause();
            audio.removeAttribute("src");
            audio.load?.();
          },
        };
      }

      const context = getWebAudioContext();
      await resumeWebAudioContextIfNeeded(context);
      const audioBuffer = await context.decodeAudioData(
        cloneToArrayBuffer(bytes),
      );
      let source: AudioBufferSourceNode | null = null;

      return {
        play: async () => {
          await resumeWebAudioContextIfNeeded(context);
          source = context.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(context.destination);
          source.onended = () => {
            try {
              source?.disconnect();
            } catch {}
            onFinished();
          };
          source.start(0);
        },
        pause: () => {
          try {
            source?.stop();
          } catch {}
        },
        remove: () => {
          try {
            source?.stop();
          } catch {}
          try {
            source?.disconnect();
          } catch {}
        },
      };
    },
    async playPcmFrame(
      bytes: Uint8Array,
      sampleRate: number,
      playbackOptions: VoicePlaybackBytesOptions,
    ): Promise<void> {
      const context = getWebAudioContext();
      const contextStateBefore = String(context.state);
      await resumeWebAudioContextIfNeeded(context);
      const contextStateAfter = String(context.state);

      const samples = float32PcmBytesToSamples(
        bytes.slice(LOCAL_PCM_FRAME_HEADER_SIZE),
      );
      const sampleSummary = summarizeFloat32Samples(samples);
      const buffer = context.createBuffer(1, samples.length, sampleRate);
      buffer.getChannelData(0).set(samples);

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const minBufferSeconds =
        (playbackOptions.playbackMinBufferMs ?? 0) / 1000;
      const startAt = Math.max(
        context.currentTime + minBufferSeconds,
        webPcmQueueEndAt,
      );
      webPcmQueueEndAt = startAt + buffer.duration;
      playbackOptions.onDebug?.({
        type: "web_pcm_schedule",
        contextStateBefore,
        contextStateAfter,
        contextSampleRate: context.sampleRate,
        frameSampleRate: sampleRate,
        samples: samples.length,
        rmsDb: sampleSummary.rmsDb,
        peak: sampleSummary.peak,
        currentTime: context.currentTime,
        startAt,
        queueEndAt: webPcmQueueEndAt,
        minBufferMs: playbackOptions.playbackMinBufferMs ?? 0,
      });
      webPcmSources.add(source);
      source.onended = () => {
        webPcmSources.delete(source);
        try {
          source.disconnect();
        } catch {}
        if (webPcmSources.size === 0) {
          onPlayingChange(false);
        }
        playbackOptions.onDebug?.({
          type: "web_pcm_end",
          contextState: String(context.state),
          currentTime: context.currentTime,
          remainingSources: webPcmSources.size,
        });
      };
      onPlayingChange(true);
      source.start(startAt);
    },
    reset(): void {
      webPcmQueueEndAt = 0;
      for (const source of webPcmSources) {
        try {
          source.stop();
        } catch {}
        try {
          source.disconnect();
        } catch {}
      }
      webPcmSources.clear();
    },
  };
}

export function createVoicePlaybackAdapter(
  options: VoicePlaybackOptions = {},
): VoicePlaybackAdapter {
  let currentSound: VoicePlaybackSound | null = null;
  let completeCurrentSound: (() => void) | null = null;
  let playbackQueue = Promise.resolve();
  let playing = false;
  let generation = {};

  const webPlayback = createWebPlaybackBackend((nextPlaying) => {
    playing = nextPlaying;
  });
  const createSound =
    options.createSound ??
    (async (uri: string, onFinished: () => void, bytes: Uint8Array) => {
      if (Platform.OS === "web") {
        return webPlayback.createSound(uri, onFinished, bytes);
      }

      return createExpoPlaybackSound(uri, onFinished);
    });

  const cacheWriter = options.writeBytesToCache ?? writeBytesToCache;
  const nativePcm =
    options.nativePcm === undefined
      ? createNativePcmPlayer()
      : options.nativePcm;
  let nativePcmEnabled = nativePcm?.isAvailable() ?? false;
  let nativePcmFailCount = 0;
  const NATIVE_PCM_MAX_FAILURES = 3;
  const IOS_WEB_PCM_EMPTY_GRACE_MS = 900;

  const enqueuePlayback = (
    bytes: Uint8Array,
    playbackOptions: VoicePlaybackBytesOptions,
  ): Promise<void> => {
    const queuedGeneration = generation;
    let resolveStarted!: () => void;
    let rejectStarted!: (error: unknown) => void;
    const started = new Promise<void>((resolve, reject) => {
      resolveStarted = resolve;
      rejectStarted = reject;
    });

    const playQueuedChunk = async () => {
      if (queuedGeneration !== generation) {
        resolveStarted();
        return;
      }

      try {
        const playableBytes = normalizePlaybackBytes(
          bytes,
          playbackOptions.sampleRate,
        );
        const uri = await cacheWriter(
          playableBytes,
          options.cacheDirectory ?? null,
        );
        let finishSound!: () => void;
        const finished = new Promise<void>((resolve) => {
          finishSound = resolve;
        });
        const nextSound = await createSound(uri, finishSound, playableBytes);

        if (queuedGeneration !== generation) {
          ignorePlaybackCleanupSync(() => nextSound.remove());
          cleanupPlaybackUri(uri);
          resolveStarted();
          return;
        }

        playing = true;
        currentSound = nextSound;
        completeCurrentSound = finishSound;
        if (Platform.OS === "web" && isIosWebBrowser()) {
          playbackOptions.onDebug?.({
            type: "web_html_start",
            bytes: playableBytes.byteLength,
          });
        }
        await nextSound.play();
        resolveStarted();

        await finished;
        if (Platform.OS === "web" && isIosWebBrowser()) {
          playbackOptions.onDebug?.({ type: "web_html_end" });
        }

        if (currentSound === nextSound) {
          currentSound = null;
          completeCurrentSound = null;
        }
        playing = false;
        ignorePlaybackCleanupSync(() => nextSound.remove());
        cleanupPlaybackUri(uri);
      } catch (error) {
        playing = false;
        rejectStarted(error);
        throw error;
      }
    };

    playbackQueue = playbackQueue.then(playQueuedChunk, playQueuedChunk);
    playbackQueue.catch(() => undefined);

    return started;
  };

  const pcmBuffer = createPcmBuffer((wavBytes) =>
    enqueuePlayback(wavBytes, {}),
  );
  const iosWebPcmBuffer = createPcmBuffer(
    (wavBytes) => enqueuePlayback(wavBytes, {}),
    { emptyGraceMs: IOS_WEB_PCM_EMPTY_GRACE_MS },
  );

  let stopped = false;

  const playLocalPcmFrame = async (
    bytes: Uint8Array,
    playbackOptions: VoicePlaybackBytesOptions,
  ): Promise<void> => {
    if (stopped) return;

    const sampleRate =
      playbackOptions.sampleRate ?? DEFAULT_LOCAL_PCM_SAMPLE_RATE;

    if (Platform.OS === "web") {
      if (webPlayback.isIosBrowser()) {
        await iosWebPcmBuffer.push(bytes, sampleRate);
        return;
      }

      await webPlayback.playPcmFrame(bytes, sampleRate, playbackOptions);
      return;
    }

    if (nativePcmEnabled) {
      try {
        if (stopped) return;
        await nativePcm?.pushFloat32Pcm(
          bytes.slice(LOCAL_PCM_FRAME_HEADER_SIZE),
          sampleRate,
          playbackOptions.playbackMinBufferMs ?? 0,
        );
        nativePcmFailCount = 0;
        playing = true;
      } catch {
        nativePcmFailCount += 1;
        if (nativePcmFailCount >= NATIVE_PCM_MAX_FAILURES) {
          nativePcmEnabled = false;
        }
        if (stopped) return;
        await pcmBuffer.push(bytes, sampleRate);
      }
      return;
    }

    if (stopped) return;
    await pcmBuffer.push(bytes, sampleRate);
  };

  function resetState() {
    stopped = true;
    generation = {};
    playing = false;
    webPlayback.reset();
    pcmBuffer.clear();
    iosWebPcmBuffer.clear();
    ignorePlaybackCleanup(nativePcm?.stop());
    ignorePlaybackCleanup(nativePcm?.reset());
    completeCurrentSound?.();
    completeCurrentSound = null;
    ignorePlaybackCleanupSync(() => currentSound?.pause());
  }

  return {
    prepare() {
      webPlayback.prepare();
    },
    async playBytes(
      bytes: Uint8Array,
      playbackOptions: VoicePlaybackBytesOptions = {},
    ) {
      stopped = false;
      if (isLocalPcmFrame(bytes)) {
        await playLocalPcmFrame(bytes, playbackOptions);
        return;
      }

      pcmBuffer.flush();
      iosWebPcmBuffer.flush();
      await enqueuePlayback(bytes, playbackOptions);
    },
    stop() {
      resetState();
    },
    release() {
      resetState();
      ignorePlaybackCleanupSync(() => currentSound?.remove());
      currentSound = null;
    },
    isPlaying() {
      return playing;
    },
  };
}
