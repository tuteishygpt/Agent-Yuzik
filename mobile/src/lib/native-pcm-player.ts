import { Buffer } from "buffer";
import { NativeModules, Platform } from "react-native";

type NativePcmPlayerModule = {
  pushFloat32Pcm: (
    base64Pcm: string,
    sampleRate: number,
    minBufferMs: number,
  ) => Promise<void>;
  reset: () => Promise<void>;
  stop: () => Promise<void>;
};

export type NativePcmPlayer = {
  isAvailable: () => boolean;
  pushFloat32Pcm: (
    bytes: Uint8Array,
    sampleRate: number,
    minBufferMs: number,
  ) => Promise<void>;
  reset: () => Promise<void>;
  stop: () => Promise<void>;
};

function getNativeModule(): NativePcmPlayerModule | null {
  const nativeModule = (NativeModules as { NativePcmPlayer?: unknown })
    .NativePcmPlayer;

  if (
    !nativeModule ||
    typeof nativeModule !== "object" ||
    typeof (nativeModule as NativePcmPlayerModule).pushFloat32Pcm !==
      "function" ||
    typeof (nativeModule as NativePcmPlayerModule).reset !== "function" ||
    typeof (nativeModule as NativePcmPlayerModule).stop !== "function"
  ) {
    return null;
  }

  return nativeModule as NativePcmPlayerModule;
}

function sanitizeFloat32PcmBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength % 4 !== 0) {
    return bytes;
  }

  const inputView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let sanitizedBytes: Uint8Array | null = null;
  let outputView: DataView | null = null;

  for (let offset = 0; offset < bytes.byteLength; offset += 4) {
    const sample = inputView.getFloat32(offset, true);
    const sanitizedSample = Number.isFinite(sample)
      ? Math.max(-1, Math.min(1, sample))
      : 0;

    if (sanitizedSample !== sample) {
      if (!sanitizedBytes) {
        sanitizedBytes = new Uint8Array(bytes);
        outputView = new DataView(
          sanitizedBytes.buffer,
          sanitizedBytes.byteOffset,
          sanitizedBytes.byteLength,
        );
      }
      outputView!.setFloat32(offset, sanitizedSample, true);
    }
  }

  return sanitizedBytes ?? bytes;
}

export function createNativePcmPlayer(): NativePcmPlayer {
  return {
    isAvailable() {
      return Platform.OS === "android" && getNativeModule() !== null;
    },
    async pushFloat32Pcm(
      bytes: Uint8Array,
      sampleRate: number,
      minBufferMs: number,
    ) {
      const nativeModule = getNativeModule();

      if (Platform.OS !== "android" || !nativeModule) {
        throw new Error("Native PCM playback is unavailable.");
      }

      const playbackBytes = sanitizeFloat32PcmBytes(bytes);
      await nativeModule.pushFloat32Pcm(
        Buffer.from(playbackBytes).toString("base64"),
        sampleRate,
        minBufferMs,
      );
    },
    async reset() {
      await getNativeModule()?.reset();
    },
    async stop() {
      await getNativeModule()?.stop();
    },
  };
}
