import { Buffer } from "buffer";
import { PermissionsAndroid, Platform } from "react-native";

export type VoiceRecordingResult = {
  uri: string | null;
  wavBytes: Uint8Array | null;
};

export type MeteringCallback = (db: number, pcm16: Uint8Array) => void;

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
const METERING_THROTTLE_MS = 50;
const MICROPHONE_PERMISSION_ERROR =
  "Microphone permission is required to start voice recording.";
const MICROPHONE_UNSUPPORTED_ERROR =
  "Microphone recording is not supported in this browser.";

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

function floatToPcm16(samples: Float32Array): Uint8Array {
  const pcm16 = new Uint8Array(samples.length * 2);
  const view = new DataView(pcm16.buffer);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const value = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(i * 2, value, true);
  }

  return pcm16;
}

function resampleFloat32(
  samples: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number,
): Float32Array {
  if (
    inputSampleRate === outputSampleRate ||
    !Number.isFinite(inputSampleRate) ||
    inputSampleRate <= 0
  ) {
    return samples;
  }

  const outputLength = Math.max(
    1,
    Math.floor((samples.length * outputSampleRate) / inputSampleRate),
  );
  const output = new Float32Array(outputLength);
  const ratio = inputSampleRate / outputSampleRate;

  for (let i = 0; i < outputLength; i++) {
    const position = i * ratio;
    const leftIndex = Math.floor(position);
    const rightIndex = Math.min(leftIndex + 1, samples.length - 1);
    const fraction = position - leftIndex;
    const left = samples[leftIndex] ?? 0;
    const right = samples[rightIndex] ?? left;
    output[i] = left + (right - left) * fraction;
  }

  return output;
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
  if (Platform.OS === "android") {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    );
    if (result !== PermissionsAndroid.RESULTS.GRANTED) {
      throw new Error(MICROPHONE_PERMISSION_ERROR);
    }
    return;
  }

  const { Audio } = require("expo-av") as typeof import("expo-av");
  const { granted } = await Audio.requestPermissionsAsync();
  if (!granted) {
    throw new Error(MICROPHONE_PERMISSION_ERROR);
  }
}

async function stopLiveAudioStream(stream: LiveAudioStream): Promise<void> {
  try {
    const stopResult = stream.stop();
    const timedOut = Symbol();
    const result = await Promise.race([
      Promise.resolve(stopResult).catch(() => undefined),
      new Promise((resolve) => setTimeout(() => resolve(timedOut), STOP_TIMEOUT_MS)),
    ]);
  } catch {}
}

function getWebAudioContextConstructor(): typeof AudioContext | undefined {
  const audioGlobal = globalThis as typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };
  return audioGlobal.AudioContext ?? audioGlobal.webkitAudioContext;
}

function createWebVoiceRecorderAdapter(): VoiceRecorderAdapter {
  type RecorderState = "idle" | "prepared" | "recording";
  type WebAudioContext = AudioContext & {
    createScriptProcessor: (
      bufferSize: number,
      numberOfInputChannels: number,
      numberOfOutputChannels: number,
    ) => ScriptProcessorNode;
  };

  let state: RecorderState = "idle";
  let stream: MediaStream | null = null;
  let context: WebAudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let pcmChunks: Uint8Array[] = [];
  let totalPcmBytes = 0;
  let meteringCb: MeteringCallback | null = null;
  let lastMeteringAt = 0;
  let peakSinceLastEmit = -160;

  async function prepareWebRecorder() {
    if (state !== "idle") return;

    const AudioContextCtor = getWebAudioContextConstructor();
    const mediaDevices = globalThis.navigator?.mediaDevices;
    if (!AudioContextCtor || !mediaDevices?.getUserMedia) {
      throw new Error(MICROPHONE_UNSUPPORTED_ERROR);
    }

    try {
      stream = await mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          channelCount: CHANNELS,
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: SAMPLE_RATE,
        },
      });
    } catch {
      throw new Error(MICROPHONE_PERMISSION_ERROR);
    }

    context = new AudioContextCtor({
      sampleRate: SAMPLE_RATE,
    }) as WebAudioContext;
    state = "prepared";
  }

  function releaseWebAudioGraph() {
    processor?.disconnect();
    source?.disconnect();
    processor = null;
    source = null;

    stream?.getTracks().forEach((track) => track.stop());
    stream = null;

    const closingContext = context;
    context = null;
    void closingContext?.close?.();
  }

  function appendPcmChunk(chunk: Uint8Array) {
    pcmChunks.push(chunk);
    totalPcmBytes += chunk.byteLength;

    if (!meteringCb) return;

    const db = computeRmsDb(chunk);
    peakSinceLastEmit = Math.max(peakSinceLastEmit, db);
    const now = Date.now();
    if (now - lastMeteringAt >= METERING_THROTTLE_MS) {
      lastMeteringAt = now;
      meteringCb(peakSinceLastEmit, chunk);
      peakSinceLastEmit = -160;
    }
  }

  return {
    async prepare() {
      await prepareWebRecorder();
    },
    async start(onMetering?: MeteringCallback) {
      if (state === "idle") {
        await prepareWebRecorder();
      }
      if (state !== "prepared" || !stream || !context) return;

      pcmChunks = [];
      totalPcmBytes = 0;
      meteringCb = onMetering ?? null;
      lastMeteringAt = 0;
      peakSinceLastEmit = -160;

      source = context.createMediaStreamSource(stream);
      processor = context.createScriptProcessor(4096, CHANNELS, CHANNELS);
      processor.onaudioprocess = (event) => {
        const samples = event.inputBuffer.getChannelData(0);
        appendPcmChunk(
          floatToPcm16(
            resampleFloat32(samples, context?.sampleRate ?? SAMPLE_RATE, SAMPLE_RATE),
          ),
        );
      };
      source.connect(processor);
      processor.connect(context.destination);
      await context.resume?.();
      state = "recording";
    },
    async stop() {
      if (state !== "recording") {
        return { uri: null, wavBytes: null };
      }

      releaseWebAudioGraph();
      state = "idle";

      if (totalPcmBytes === 0) {
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

      return { uri: null, wavBytes };
    },
  };
}

export function createDefaultVoiceRecorderAdapter(): VoiceRecorderAdapter {
  return createVoiceRecorderAdapter();
}

export function createVoiceRecorderAdapter(
  _injectedRecorder?: unknown,
): VoiceRecorderAdapter {
  if (Platform.OS === "web") {
    return createWebVoiceRecorderAdapter();
  }

  type RecorderState = "idle" | "prepared" | "recording" | "stopping";
  let state: RecorderState = "idle";
  let pcmChunks: Uint8Array[] = [];
  let totalPcmBytes = 0;
  let meteringCb: MeteringCallback | null = null;
  let lastMeteringAt = 0;
  let peakSinceLastEmit = -160;
  let activeStream: LiveAudioStream | null = null;
  let permissionGranted = false;

  return {
    async prepare() {
      if (state !== "idle") return;

      await ensureMicrophonePermission();
      permissionGranted = true;
      state = "prepared";
    },
    async start(onMetering?: MeteringCallback) {
      if (state !== "prepared") return;

      if (!permissionGranted) {
        await ensureMicrophonePermission();
        permissionGranted = true;
      }

      pcmChunks = [];
      totalPcmBytes = 0;
      meteringCb = onMetering ?? null;

      const stream = loadLiveAudioStream();
      stream.init({
        sampleRate: SAMPLE_RATE,
        channels: CHANNELS,
        bitsPerSample: BITS_PER_SAMPLE,
        audioSource: 6,
      });
      activeStream = stream;

      stream.on("data", (base64: string) => {
        const chunk = new Uint8Array(Buffer.from(base64, "base64"));
        pcmChunks.push(chunk);
        totalPcmBytes += chunk.byteLength;

        if (meteringCb) {
          const db = computeRmsDb(chunk);
          peakSinceLastEmit = Math.max(peakSinceLastEmit, db);
          const now = Date.now();
          if (now - lastMeteringAt >= METERING_THROTTLE_MS) {
            lastMeteringAt = now;
            meteringCb(peakSinceLastEmit, chunk);
            peakSinceLastEmit = -160;
          }
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
      const stream = activeStream;
      activeStream = null;

      if (stream) {
        await stopLiveAudioStream(stream);
      }

      if (totalPcmBytes === 0) {
        state = "prepared";
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
      state = "prepared";

      return { uri: null, wavBytes };
    },
  };
}
