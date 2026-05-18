import * as FileSystem from "expo-file-system/legacy";

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
  playbackMinBufferMs?: number;
};

type VoicePlaybackSound = {
  play: () => void;
  pause: () => void;
  remove: () => void;
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

function deleteCacheFile(uri: string): void {
  void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
}

export function createVoicePlaybackAdapter(
  options: VoicePlaybackOptions = {},
): VoicePlaybackAdapter {
  const createSound =
    options.createSound ??
    (async (uri: string, onFinished: () => void) => {
      const audioModule = require("expo-audio/build/AudioModule").default as {
        AudioPlayer?: new (
          source: { uri: string },
          updateInterval: number,
          keepAudioSessionActive: boolean,
        ) => VoicePlaybackSound & {
          addListener?: (
            eventName: "playbackStatusUpdate",
            listener: (status: {
              didJustFinish?: boolean;
              isLoaded?: boolean;
            }) => void,
          ) => { remove: () => void };
        };
      };

      if (!audioModule.AudioPlayer) {
        throw new Error("Expo audio playback is unavailable.");
      }

      const player = new audioModule.AudioPlayer({ uri }, 500, false);
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
    });

  const cacheWriter = options.writeBytesToCache ?? writeBytesToCache;
  let currentSound: VoicePlaybackSound | null = null;
  let completeCurrentSound: (() => void) | null = null;
  let playbackQueue = Promise.resolve();
  let playing = false;
  let generation = {};
  const nativePcm =
    options.nativePcm === undefined
      ? createNativePcmPlayer()
      : options.nativePcm;
  let nativePcmEnabled = nativePcm?.isAvailable() ?? false;
  let nativePcmFailCount = 0;
  const NATIVE_PCM_MAX_FAILURES = 3;

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
          normalizePlaybackBytes(bytes, playbackOptions.sampleRate),
          options.cacheDirectory ?? null,
        );
        let finishSound!: () => void;
        const finished = new Promise<void>((resolve) => {
          finishSound = resolve;
        });
        const nextSound = await createSound(uri, finishSound);

        if (queuedGeneration !== generation) {
          ignorePlaybackCleanupSync(() => nextSound.remove());
          deleteCacheFile(uri);
          resolveStarted();
          return;
        }

        playing = true;
        currentSound = nextSound;
        completeCurrentSound = finishSound;
        nextSound.play();
        resolveStarted();

        await finished;

        if (currentSound === nextSound) {
          currentSound = null;
          completeCurrentSound = null;
        }
        playing = false;
        ignorePlaybackCleanupSync(() => nextSound.remove());
        deleteCacheFile(uri);
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
          playbackOptions.playbackMinBufferMs ?? 0,
        );
        nativePcmFailCount = 0;
        playing = true;
        return;
      } catch {
        nativePcmFailCount += 1;
        if (nativePcmFailCount >= NATIVE_PCM_MAX_FAILURES) {
          nativePcmEnabled = false;
        }
      }
    }

    await pcmBuffer.push(bytes, sampleRate);
  };

  function resetState() {
    generation = {};
    playing = false;
    pcmBuffer.clear();
    ignorePlaybackCleanup(nativePcm?.stop());
    ignorePlaybackCleanup(nativePcm?.reset());
    completeCurrentSound?.();
    completeCurrentSound = null;
    ignorePlaybackCleanupSync(() => currentSound?.pause());
  }

  return {
    async playBytes(
      bytes: Uint8Array,
      playbackOptions: VoicePlaybackBytesOptions = {},
    ) {
      if (isLocalPcmFrame(bytes)) {
        await playLocalPcmFrame(bytes, playbackOptions);
        return;
      }

      pcmBuffer.flush();
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
