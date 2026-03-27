import { Buffer } from "buffer";

import FileSystem from "expo-file-system/legacy";

export type VoiceRecordingResult = {
  uri: string | null;
  wavBytes: Uint8Array | null;
};

export type VoiceRecorderAdapter = {
  prepare: () => Promise<void>;
  start: () => void;
  stop: () => Promise<VoiceRecordingResult>;
};

type ExpoAudioRecorderLike = {
  uri: string | null;
  prepareToRecordAsync: (options?: unknown) => Promise<void>;
  record: () => void;
  stop: () => Promise<void>;
};

function base64ToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function loadExpoAudioModule() {
  return require("expo-audio") as {
    AudioRecorder: new (options: Record<string, unknown>) => ExpoAudioRecorderLike;
    RecordingPresets: {
      HIGH_QUALITY: Record<string, unknown>;
    };
    setAudioModeAsync: (mode: Record<string, unknown>) => Promise<void>;
  };
}

export async function readRecordingBytes(uri: string): Promise<Uint8Array> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return base64ToBytes(base64);
}

export function createDefaultVoiceRecorderAdapter(): VoiceRecorderAdapter {
  const expoAudio = loadExpoAudioModule();
  const recorder = new expoAudio.AudioRecorder(expoAudio.RecordingPresets.HIGH_QUALITY);

  return createVoiceRecorderAdapter(recorder);
}

export function createVoiceRecorderAdapter(
  recorder: ExpoAudioRecorderLike,
): VoiceRecorderAdapter {
  const expoAudio = loadExpoAudioModule();
  const recordingOptions = {
    ...expoAudio.RecordingPresets.HIGH_QUALITY,
    extension: ".wav",
  };

  return {
    async prepare() {
      await expoAudio.setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync(recordingOptions);
    },
    start() {
      recorder.record();
    },
    async stop() {
      await recorder.stop();

      if (!recorder.uri) {
        return {
          uri: null,
          wavBytes: null,
        };
      }

      return {
        uri: recorder.uri,
        wavBytes: await readRecordingBytes(recorder.uri),
      };
    },
  };
}
