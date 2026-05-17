import { Buffer } from "buffer";

import * as FileSystem from "expo-file-system/legacy";

import {
  createNativePcmPlayer,
  type NativePcmPlayer,
} from "./native-pcm-player";

export type VoicePlaybackAdapter = {
  playBytes: (
    bytes: Uint8Array,
    options?: VoicePlaybackBytesOptions,
  ) => Promise<void>;
  stop: () => void;
  release: () => void;
  isPlaying: () => boolean;
};

export type VoicePlaybackBytesOptions = {
  sampleRate?: number;
};

type VoicePlaybackSound = {
  playAsync: () => Promise<unknown>;
  pauseAsync: () => Promise<unknown>;
  unloadAsync: () => Promise<unknown>;
};

type VoicePlaybackOptions = {
  nativePcm?: NativePcmPlayer | null;
  createSound?: (
    uri: string,
    onFinished: () => void,
  ) => Promise<VoicePlaybackSound>;
  cacheDirectory?: string | null;
  writeBytesToCache?: (
    bytes: Uint8Array,
    cacheDirectory: string | null,
  ) => Promise<string>;
};

const LOCAL_PCM_FRAME_HEADER_SIZE = 8;
const DEFAULT_LOCAL_PCM_SAMPLE_RATE = 24000;
const DEFAULT_LOCAL_PCM_EMPTY_GRACE_MS = 120;

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function startsWithBytes(bytes: Uint8Array, expected: number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

function createFloat32WavHeader(
  dataLength: number,
  sampleRate: number,
): Uint8Array {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const channels = 1;
  const bytesPerSample = 4;

  header.set([0x52, 0x49, 0x46, 0x46], 0);
  view.setUint32(4, dataLength + 36, true);
  header.set([0x57, 0x41, 0x56, 0x45], 8);
  header.set([0x66, 0x6d, 0x74, 0x20], 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  header.set([0x64, 0x61, 0x74, 0x61], 36);
  view.setUint32(40, dataLength, true);

  return header;
}

function wrapLocalPcmFrameAsWav(
  bytes: Uint8Array,
  sampleRate: number,
): Uint8Array {
  const pcmBytes = bytes.slice(LOCAL_PCM_FRAME_HEADER_SIZE);
  return wrapFloat32PcmAsWav(pcmBytes, sampleRate);
}

function wrapFloat32PcmAsWav(
  pcmBytes: Uint8Array,
  sampleRate: number,
): Uint8Array {
  const wavBytes = new Uint8Array(44 + pcmBytes.byteLength);

  wavBytes.set(createFloat32WavHeader(pcmBytes.byteLength, sampleRate), 0);
  wavBytes.set(pcmBytes, 44);

  return wavBytes;
}

function isLocalPcmFrame(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= LOCAL_PCM_FRAME_HEADER_SIZE &&
    startsWithBytes(bytes, [0x50, 0x43, 0x4d, 0x00])
  );
}

function getLocalPcmSampleCount(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(4, true);
}

function concatBytes(chunks: Uint8Array[], totalLength: number): Uint8Array {
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
}

function normalizePlaybackBytes(
  bytes: Uint8Array,
  options: VoicePlaybackBytesOptions = {},
): Uint8Array {
  if (isLocalPcmFrame(bytes)) {
    return wrapLocalPcmFrameAsWav(
      bytes,
      options.sampleRate ?? DEFAULT_LOCAL_PCM_SAMPLE_RATE,
    );
  }

  return bytes;
}

function ignorePlaybackCleanup(promise: Promise<unknown> | undefined): void {
  void promise?.catch(() => undefined);
}

async function writeBytesToCache(
  bytes: Uint8Array,
  cacheDirectory: string | null,
): Promise<string> {
  const directory = cacheDirectory ?? FileSystem.cacheDirectory;

  if (!directory) {
    throw new Error("File system cache directory is unavailable.");
  }

  const uri = `${directory.replace(/\/+$/, "")}/yuzik-voice-response.wav`;
  await FileSystem.writeAsStringAsync(uri, bytesToBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });

  return uri;
}

export function createVoicePlaybackAdapter(
  options: VoicePlaybackOptions = {},
): VoicePlaybackAdapter {
  const createSound =
    options.createSound ??
    (async (uri: string, onFinished: () => void) => {
      const expoAvAudio = (
        require("expo-av") as {
          Audio: {
            Sound: {
              createAsync: (
                source: { uri: string },
                initialStatus: { shouldPlay: boolean },
                onPlaybackStatusUpdate: (status: {
                  didJustFinish?: boolean;
                  isLoaded?: boolean;
                }) => void,
                downloadFirst: boolean,
              ) => Promise<{ sound: VoicePlaybackSound }>;
            };
          };
        }
      ).Audio;

      const { sound } = await expoAvAudio.Sound.createAsync(
        { uri },
        { shouldPlay: false },
        (status) => {
          if (status.isLoaded !== false && status.didJustFinish) {
            onFinished();
          }
        },
        false,
      );
      return sound;
    });
  const cacheWriter = options.writeBytesToCache ?? writeBytesToCache;
  let currentSound: VoicePlaybackSound | null = null;
  let completeCurrentSound: (() => void) | null = null;
  let playbackQueue = Promise.resolve();
  let playing = false;
  let generation = 0;
  let pendingPcmChunks: Uint8Array[] = [];
  let pendingPcmResolvers: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
  }> = [];
  let pendingPcmBytes = 0;
  let pendingPcmSampleRate = DEFAULT_LOCAL_PCM_SAMPLE_RATE;
  let pendingPcmTimer: ReturnType<typeof setTimeout> | null = null;
  const nativePcm =
    options.nativePcm === undefined ? createNativePcmPlayer() : options.nativePcm;
  let nativePcmEnabled = nativePcm?.isAvailable() ?? false;

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
        const uri = await cacheWriter(
          normalizePlaybackBytes(bytes, playbackOptions),
          options.cacheDirectory ?? null,
        );
        let finishSound!: () => void;
        const finished = new Promise<void>((resolve) => {
          finishSound = resolve;
        });
        const nextSound = await createSound(uri, finishSound);

        if (queuedGeneration !== generation) {
          ignorePlaybackCleanup(nextSound.unloadAsync());
          resolveStarted();
          return;
        }

        currentSound = nextSound;
        completeCurrentSound = finishSound;
        await nextSound.playAsync();
        playing = true;
        resolveStarted();

        await finished;

        if (currentSound === nextSound) {
          currentSound = null;
          completeCurrentSound = null;
        }
        playing = false;
        await nextSound.unloadAsync().catch(() => undefined);
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

  const clearPendingPcmTimer = () => {
    if (pendingPcmTimer) {
      clearTimeout(pendingPcmTimer);
      pendingPcmTimer = null;
    }
  };

  const flushPendingPcm = () => {
    if (!pendingPcmBytes) {
      return;
    }

    clearPendingPcmTimer();

    const pcmBytes = concatBytes(pendingPcmChunks, pendingPcmBytes);
    const resolvers = pendingPcmResolvers;
    const sampleRate = pendingPcmSampleRate;

    pendingPcmChunks = [];
    pendingPcmResolvers = [];
    pendingPcmBytes = 0;
    pendingPcmSampleRate = DEFAULT_LOCAL_PCM_SAMPLE_RATE;

    void enqueuePlayback(wrapFloat32PcmAsWav(pcmBytes, sampleRate), {})
      .then(() => {
        resolvers.forEach(({ resolve }) => resolve());
      })
      .catch((error: unknown) => {
        resolvers.forEach(({ reject }) => reject(error));
      });
  };

  const bufferLocalPcmFrame = (
    bytes: Uint8Array,
    playbackOptions: VoicePlaybackBytesOptions,
  ): Promise<void> => {
    const sampleRate =
      playbackOptions.sampleRate ??
      pendingPcmSampleRate ??
      DEFAULT_LOCAL_PCM_SAMPLE_RATE;
    const pcmBytes = bytes.slice(LOCAL_PCM_FRAME_HEADER_SIZE);
    const declaredBytes = getLocalPcmSampleCount(bytes) * 4;

    pendingPcmSampleRate = sampleRate;
    pendingPcmChunks.push(
      pcmBytes.byteLength === declaredBytes ? pcmBytes : pcmBytes.slice(0),
    );
    pendingPcmBytes += pcmBytes.byteLength;

    clearPendingPcmTimer();
    pendingPcmTimer = setTimeout(
      flushPendingPcm,
      DEFAULT_LOCAL_PCM_EMPTY_GRACE_MS,
    );

    return new Promise<void>((resolve, reject) => {
      pendingPcmResolvers.push({ resolve, reject });
    });
  };

  const playLocalPcmFrame = async (
    bytes: Uint8Array,
    playbackOptions: VoicePlaybackBytesOptions,
  ): Promise<void> => {
    const sampleRate =
      playbackOptions.sampleRate ?? DEFAULT_LOCAL_PCM_SAMPLE_RATE;

    if (nativePcmEnabled) {
      try {
        await nativePcm?.pushFloat32Pcm(
          bytes.slice(LOCAL_PCM_FRAME_HEADER_SIZE),
          sampleRate,
        );
        playing = true;
        return;
      } catch {
        nativePcmEnabled = false;
      }
    }

    await bufferLocalPcmFrame(bytes, playbackOptions);
  };

  return {
    async playBytes(
      bytes: Uint8Array,
      playbackOptions: VoicePlaybackBytesOptions = {},
    ) {
      if (isLocalPcmFrame(bytes)) {
        await playLocalPcmFrame(bytes, playbackOptions);
        return;
      }

      flushPendingPcm();
      await enqueuePlayback(bytes, playbackOptions);
    },
    stop() {
      generation += 1;
      playing = false;
      clearPendingPcmTimer();
      pendingPcmChunks = [];
      pendingPcmResolvers.forEach(({ resolve }) => resolve());
      pendingPcmResolvers = [];
      pendingPcmBytes = 0;
      ignorePlaybackCleanup(nativePcm?.stop());
      ignorePlaybackCleanup(nativePcm?.reset());
      completeCurrentSound?.();
      completeCurrentSound = null;
      ignorePlaybackCleanup(currentSound?.pauseAsync());
    },
    release() {
      generation += 1;
      playing = false;
      clearPendingPcmTimer();
      pendingPcmChunks = [];
      pendingPcmResolvers.forEach(({ resolve }) => resolve());
      pendingPcmResolvers = [];
      pendingPcmBytes = 0;
      ignorePlaybackCleanup(nativePcm?.stop());
      ignorePlaybackCleanup(nativePcm?.reset());
      completeCurrentSound?.();
      completeCurrentSound = null;
      ignorePlaybackCleanup(currentSound?.pauseAsync());
      ignorePlaybackCleanup(currentSound?.unloadAsync());
      currentSound = null;
    },
    isPlaying() {
      return playing;
    },
  };
}
