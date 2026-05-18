import { Buffer } from "buffer";
import { PermissionsAndroid, Platform } from "react-native";

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

const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;
const STOP_TIMEOUT_MS = 100;
const MICROPHONE_PERMISSION_ERROR =
  "Microphone permission is required to start voice recording.";

function createWavHeader(pcmLength: number): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const byteRate = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE;
  const blockAlign = CHANNELS * BYTES_PER_SAMPLE;

  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + pcmLength, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, pcmLength, true);

  return new Uint8Array(header);
}

function computeRmsDb(pcm16: Uint8Array): number {
  const samples = new Int16Array(
    pcm16.buffer,
    pcm16.byteOffset,
    pcm16.byteLength / 2,
  );
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    const normalized = samples[i] / 32768;
    sumSq += normalized * normalized;
  }
  const rms = Math.sqrt(sumSq / samples.length);
  if (rms < 1e-10) return -160;
  return 20 * Math.log10(rms);
}

type LiveAudioStream = {
  init: (options: {
    sampleRate: number;
    channels: number;
    bitsPerSample: number;
    audioSource?: number;
    wavFile?: string;
  }) => void;
  start: () => void;
  stop: () => Promise<string> | string | void;
  on: (event: "data", callback: (data: string) => void) => void;
};

function loadLiveAudioStream(): LiveAudioStream {
  return (
    require("react-native-live-audio-stream") as { default: LiveAudioStream }
  ).default;
}

async function ensureMicrophonePermission(): Promise<void> {
  if (Platform.OS !== "android") {
    return;
  }

  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  );

  if (result !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error(MICROPHONE_PERMISSION_ERROR);
  }
}

async function stopLiveAudioStream(stream: LiveAudioStream): Promise<void> {
  try {
    const stopResult = stream.stop();
    await Promise.race([
      Promise.resolve(stopResult).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS)),
    ]);
  } catch {}
}

export async function readRecordingBytes(_uri: string): Promise<Uint8Array> {
  return new Uint8Array(0);
}

export function createDefaultVoiceRecorderAdapter(): VoiceRecorderAdapter {
  return createVoiceRecorderAdapter();
}

type RecorderState = "idle" | "prepared" | "recording" | "stopping";

export function createVoiceRecorderAdapter(
  _injectedRecorder?: unknown,
): VoiceRecorderAdapter {
  let state: RecorderState = "idle";
  let pcmChunks: Uint8Array[] = [];
  let totalPcmBytes = 0;
  let meteringCb: MeteringCallback | null = null;

  return {
    async prepare() {
      if (state !== "idle") return;

      await ensureMicrophonePermission();

      const stream = loadLiveAudioStream();
      stream.init({
        sampleRate: SAMPLE_RATE,
        channels: CHANNELS,
        bitsPerSample: BITS_PER_SAMPLE,
        audioSource: 6,
      });

      state = "prepared";
    },
    async start(onMetering?: MeteringCallback) {
      if (state !== "prepared") return;

      pcmChunks = [];
      totalPcmBytes = 0;
      meteringCb = onMetering ?? null;

      const stream = loadLiveAudioStream();
      stream.on("data", (base64: string) => {
        const chunk = new Uint8Array(Buffer.from(base64, "base64"));
        pcmChunks.push(chunk);
        totalPcmBytes += chunk.byteLength;

        if (meteringCb) {
          meteringCb(computeRmsDb(chunk));
        }
      });

      stream.start();
      state = "recording";
    },
    async stop() {
      if (state !== "recording") {
        return { uri: null, wavBytes: null };
      }

      state = "stopping";
      const stream = loadLiveAudioStream();
      await stopLiveAudioStream(stream);

      if (totalPcmBytes === 0) {
        state = "idle";
        return { uri: null, wavBytes: null };
      }

      const wavHeader = createWavHeader(totalPcmBytes);
      const wavBytes = new Uint8Array(44 + totalPcmBytes);
      wavBytes.set(wavHeader, 0);
      let offset = 44;
      for (const chunk of pcmChunks) {
        wavBytes.set(chunk, offset);
        offset += chunk.byteLength;
      }

      pcmChunks = [];
      totalPcmBytes = 0;
      state = "idle";

      return { uri: null, wavBytes };
    },
  };
}
