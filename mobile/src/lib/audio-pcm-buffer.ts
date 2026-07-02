import {
  concatBytes,
  DEFAULT_LOCAL_PCM_EMPTY_GRACE_MS,
  DEFAULT_LOCAL_PCM_SAMPLE_RATE,
  getLocalPcmSampleCount,
  LOCAL_PCM_FRAME_HEADER_SIZE,
  wrapFloat32PcmAsWav,
} from "./audio-pcm-format";

type PcmResolver = {
  resolve: () => void;
  reject: (error: unknown) => void;
};

export type PcmBuffer = {
  push: (bytes: Uint8Array, sampleRate: number) => Promise<void>;
  flush: () => void;
  clear: () => void;
  hasPending: () => boolean;
};

type PcmBufferOptions = {
  emptyGraceMs?: number;
};

const MAX_BUFFER_BYTES = 512 * 1024; // 512KB auto-flush threshold

export function createPcmBuffer(
  onFlush: (wavBytes: Uint8Array) => Promise<void>,
  options: PcmBufferOptions = {},
): PcmBuffer {
  let chunks: Uint8Array[] = [];
  let resolvers: PcmResolver[] = [];
  let totalBytes = 0;
  let sampleRate = DEFAULT_LOCAL_PCM_SAMPLE_RATE;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function flush() {
    if (!totalBytes) return;
    clearTimer();

    const pcmBytes = concatBytes(chunks, totalBytes);
    const currentResolvers = resolvers;
    const currentRate = sampleRate;

    chunks = [];
    resolvers = [];
    totalBytes = 0;
    sampleRate = DEFAULT_LOCAL_PCM_SAMPLE_RATE;

    void onFlush(wrapFloat32PcmAsWav(pcmBytes, currentRate))
      .then(() => currentResolvers.forEach(({ resolve }) => resolve()))
      .catch((error: unknown) =>
        currentResolvers.forEach(({ reject }) => reject(error)),
      );
  }

  function clear() {
    clearTimer();
    chunks = [];
    resolvers.forEach(({ resolve }) => resolve());
    resolvers = [];
    totalBytes = 0;
  }

  return {
    push(bytes: Uint8Array, requestedSampleRate: number): Promise<void> {
      if (totalBytes > 0 && requestedSampleRate !== sampleRate) {
        flush();
      }

      const pcmBytes = bytes.slice(LOCAL_PCM_FRAME_HEADER_SIZE);
      const declaredBytes = getLocalPcmSampleCount(bytes) * 4;

      sampleRate = requestedSampleRate;
      chunks.push(pcmBytes.slice(0));
      totalBytes += pcmBytes.byteLength;

      if (totalBytes >= MAX_BUFFER_BYTES) {
        flush();
      } else {
        clearTimer();
        timer = setTimeout(
          flush,
          options.emptyGraceMs ?? DEFAULT_LOCAL_PCM_EMPTY_GRACE_MS,
        );
      }

      return new Promise<void>((resolve, reject) => {
        resolvers.push({ resolve, reject });
      });
    },
    flush,
    clear,
    hasPending: () => totalBytes > 0,
  };
}
