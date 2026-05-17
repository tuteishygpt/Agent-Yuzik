import { Buffer } from "buffer";
import { NativeModules, Platform } from "react-native";

type NativePcmPlayerModule = {
  pushFloat32Pcm: (base64Pcm: string, sampleRate: number) => Promise<void>;
  reset: () => Promise<void>;
  stop: () => Promise<void>;
};

export type NativePcmPlayer = {
  isAvailable: () => boolean;
  pushFloat32Pcm: (bytes: Uint8Array, sampleRate: number) => Promise<void>;
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

export function createNativePcmPlayer(): NativePcmPlayer {
  return {
    isAvailable() {
      return Platform.OS === "android" && getNativeModule() !== null;
    },
    async pushFloat32Pcm(bytes: Uint8Array, sampleRate: number) {
      const nativeModule = getNativeModule();

      if (Platform.OS !== "android" || !nativeModule) {
        throw new Error("Native PCM playback is unavailable.");
      }

      await nativeModule.pushFloat32Pcm(
        Buffer.from(bytes).toString("base64"),
        sampleRate,
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
