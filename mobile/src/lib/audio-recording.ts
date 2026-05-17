import { Buffer } from "buffer";

import * as FileSystem from "expo-file-system/legacy";

export type VoiceRecordingResult = {
  uri: string | null;
  wavBytes: Uint8Array | null;
};

export type MeteringCallback = (db: number) => void;

export type VoiceRecorderAdapter = {
  prepare: () => Promise<void>;
  start: (onMetering?: MeteringCallback) => Promise<void>;
  stop: () => Promise<VoiceRecordingResult>;
};

function base64ToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

export async function readRecordingBytes(uri: string): Promise<Uint8Array> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return base64ToBytes(base64);
}

type RecorderState = "idle" | "prepared" | "recording" | "stopping";

type ExpoAudioModule = {
  AudioRecorder: new (options: Record<string, unknown>) => ExpoAudioRecorderLike;
  requestRecordingPermissionsAsync: () => Promise<{ granted: boolean }>;
  setAudioModeAsync: (mode: Record<string, unknown>) => Promise<void>;
};

type ExpoAudioRecorderLike = {
  prepareToRecordAsync: (options?: Record<string, unknown>) => Promise<void>;
  record: () => void;
  stop: () => Promise<void>;
  getStatus: () => { isRecording: boolean; metering?: number; url: string | null };
  uri: string | null;
};

const METERING_INTERVAL_MS = 100;

function loadExpoAudioModule(): ExpoAudioModule {
  return require("expo-audio/build/AudioModule").default as ExpoAudioModule;
}

const RECORDING_OPTIONS = {
  isMeteringEnabled: true,
  extension: ".m4a",
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 64000,
  android: {
    outputFormat: "mpeg4",
    audioEncoder: "aac",
  },
  ios: {
    outputFormat: "aac ",
    audioQuality: 96,
  },
  web: {
    mimeType: "audio/webm",
    bitsPerSecond: 64000,
  },
};

export function createDefaultVoiceRecorderAdapter(): VoiceRecorderAdapter {
  return createVoiceRecorderAdapter();
}

export function createVoiceRecorderAdapter(
  injectedRecorder?: ExpoAudioRecorderLike,
): VoiceRecorderAdapter {
  const expoAudio = loadExpoAudioModule();
  let state: RecorderState = "idle";
  let recorder: ExpoAudioRecorderLike =
    injectedRecorder ?? new expoAudio.AudioRecorder(RECORDING_OPTIONS);
  let meteringTimer: ReturnType<typeof setInterval> | null = null;

  function clearMeteringTimer() {
    if (meteringTimer) {
      clearInterval(meteringTimer);
      meteringTimer = null;
    }
  }

  return {
    async prepare() {
      if (state !== "idle") return;

      const permission = await expoAudio.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        throw new Error("Microphone permission is required for voice recording.");
      }

      await expoAudio.setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
        interruptionMode: "doNotMix",
        shouldRouteThroughEarpiece: false,
        shouldPlayInBackground: false,
      });

      await recorder.prepareToRecordAsync(RECORDING_OPTIONS);
      state = "prepared";
    },
    async start(onMetering?: MeteringCallback) {
      if (state !== "prepared") return;

      recorder.record();
      state = "recording";

      if (onMetering) {
        meteringTimer = setInterval(() => {
          if (state !== "recording") return;
          const status = recorder.getStatus();
          if (status.isRecording && status.metering != null) {
            onMetering(status.metering);
          }
        }, METERING_INTERVAL_MS);
      }
    },
    async stop() {
      clearMeteringTimer();

      if (state !== "recording") {
        return { uri: null, wavBytes: null };
      }

      state = "stopping";
      try {
        await recorder.stop();
      } catch {
        state = "idle";
        if (!injectedRecorder) {
          recorder = new expoAudio.AudioRecorder(RECORDING_OPTIONS);
        }
        return { uri: null, wavBytes: null };
      }
      state = "idle";

      const uri = recorder.uri;
      if (!injectedRecorder) {
        recorder = new expoAudio.AudioRecorder(RECORDING_OPTIONS);
      }

      if (!uri) {
        return { uri: null, wavBytes: null };
      }

      return {
        uri,
        wavBytes: await readRecordingBytes(uri),
      };
    },
  };
}
