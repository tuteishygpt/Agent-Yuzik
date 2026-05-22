import { Buffer } from "buffer";
import { NativeModules, Platform } from "react-native";

export type VadConfig = {
  /** dB threshold to trigger speech start (e.g. -30). Higher = less sensitive. */
  positiveSpeechThreshold: number;
  /** dB threshold to trigger speech end (e.g. -50). Lower = requires more silence. */
  negativeSpeechThreshold: number;
  /** Consecutive silent frames before speech is considered ended. */
  redemptionFrames: number;
  /** Minimum speech frames before a segment is considered valid. */
  minSpeechFrames: number;
  /** Prefer TEN VAD native inference when the platform module is available. */
  preferNativeTenVad: boolean;
  /** TEN VAD detection threshold in the range [0.0, 1.0]. */
  tenVadThreshold: number;
  /** TEN VAD frame size in 16 kHz PCM samples. */
  tenVadHopSize: 160 | 256;
  /** Lowest dB level where native TEN VAD may start speech. */
  nativeTenVadEnergyFloorDb: number;
  /** Adapt the native TEN VAD energy floor to the current microphone noise. */
  adaptNativeTenVadEnergyFloor: boolean;
  /** Short startup sample count used to estimate the current noise floor. */
  nativeTenVadCalibrationFrames: number;
  /** dB margin above measured noise before TEN VAD may start speech. */
  nativeTenVadNoiseMarginDb: number;
  /** Lower clamp for the adaptive TEN VAD energy floor. */
  nativeTenVadMinEnergyFloorDb: number;
  /** Upper clamp for the adaptive TEN VAD energy floor. */
  nativeTenVadMaxEnergyFloorDb: number;
};

export type VadCallbacks = {
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
  onFrameProcessed?: (db: number, isSpeech: boolean) => void;
};

export type VadInstance = {
  processFrame: (db: number, pcm16?: Uint8Array) => void;
  reset: () => void;
  destroy: () => void;
  pause: () => void;
  resume: () => void;
  readonly isSpeaking: boolean;
  readonly isPaused: boolean;
};

export const DEFAULT_VAD_CONFIG: VadConfig = {
  positiveSpeechThreshold: -40,
  negativeSpeechThreshold: -42,
  redemptionFrames: 8,
  minSpeechFrames: 3,
  preferNativeTenVad: true,
  tenVadThreshold: 0.5,
  tenVadHopSize: 256,
  nativeTenVadEnergyFloorDb: -65,
  adaptNativeTenVadEnergyFloor: true,
  nativeTenVadCalibrationFrames: 8,
  nativeTenVadNoiseMarginDb: 3,
  nativeTenVadMinEnergyFloorDb: -75,
  nativeTenVadMaxEnergyFloorDb: -45,
};

type TenVadNativeResult = {
  probability: number;
  isSpeech: boolean;
};

type TenVadNativeModule = {
  create: (hopSize: number, threshold: number) => Promise<void>;
  processPcm16: (base64Pcm16: string) => Promise<TenVadNativeResult[]>;
  reset: () => Promise<void>;
  destroy: () => Promise<void>;
};

const nativeTenVad = NativeModules.TenVad as TenVadNativeModule | undefined;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? -160;
}

function shouldUseNativeTenVad(cfg: VadConfig): boolean {
  return Boolean(
    cfg.preferNativeTenVad &&
      Platform.OS === "android" &&
      nativeTenVad?.create &&
      nativeTenVad.processPcm16,
  );
}

export function createVad(
  callbacks: VadCallbacks,
  config: Partial<VadConfig> = {},
): VadInstance {
  const cfg = { ...DEFAULT_VAD_CONFIG, ...config };
  let speechFrames = 0;
  let silenceFrames = 0;
  let speaking = false;
  let paused = false;
  const useNativeTenVad = shouldUseNativeTenVad(cfg);
  let nativeReady = false;
  let nativeQueue = Promise.resolve();
  let adaptiveNativeEnergyFloorDb = cfg.nativeTenVadEnergyFloorDb;
  let nativeNoiseFloorDb: number | null = null;
  let nativeCalibrationDbs: number[] = [];

  if (useNativeTenVad) {
    nativeQueue = nativeTenVad!
      .create(cfg.tenVadHopSize, cfg.tenVadThreshold)
      .then(() => {
        nativeReady = true;
      })
      .catch((error) => {
        nativeReady = false;
        console.warn("[VAD] TEN VAD unavailable, falling back to energy VAD", error);
      });
  }

  function processDecision(db: number, isSpeech: boolean, isSilence: boolean) {
    if (paused) return;

    callbacks.onFrameProcessed?.(db, isSpeech);

    if (speaking) {
      if (isSilence) {
        silenceFrames++;
        if (silenceFrames >= cfg.redemptionFrames) {
          speaking = false;
          speechFrames = 0;
          silenceFrames = 0;
          callbacks.onSpeechEnd();
        }
      } else {
        silenceFrames = 0;
      }
    } else {
      if (isSpeech) {
        speechFrames++;
        silenceFrames = 0;
        if (speechFrames >= cfg.minSpeechFrames) {
          speaking = true;
          callbacks.onSpeechStart();
        }
      } else {
        speechFrames = Math.max(0, speechFrames - 1);
        silenceFrames++;
      }
    }
  }

  function processFrame(db: number, pcm16?: Uint8Array) {
    if (paused) return;

    if (!useNativeTenVad || !pcm16) {
      processDecision(
        db,
        db >= cfg.positiveSpeechThreshold,
        db < cfg.negativeSpeechThreshold,
      );
      return;
    }

    const payload = Buffer.from(pcm16).toString("base64");
    nativeQueue = nativeQueue
      .then(() => {
        if (paused) return undefined;
        if (!nativeReady) {
          processDecision(
            db,
            db >= cfg.positiveSpeechThreshold,
            db < cfg.negativeSpeechThreshold,
          );
          return undefined;
        }
        return nativeTenVad!.processPcm16(payload);
      })
      .then((results) => {
        if (!results || paused) return;
        for (const result of results) {
          const isCalibrating =
            cfg.adaptNativeTenVadEnergyFloor &&
            nativeCalibrationDbs.length < cfg.nativeTenVadCalibrationFrames;
          if (isCalibrating) {
            nativeCalibrationDbs.push(db);
            const estimatedNoiseFloor = median(nativeCalibrationDbs);
            nativeNoiseFloorDb = estimatedNoiseFloor;
            adaptiveNativeEnergyFloorDb = clamp(
              estimatedNoiseFloor + cfg.nativeTenVadNoiseMarginDb,
              cfg.nativeTenVadMinEnergyFloorDb,
              cfg.nativeTenVadMaxEnergyFloorDb,
            );
          } else if (
            cfg.adaptNativeTenVadEnergyFloor &&
            (!result.isSpeech || db < adaptiveNativeEnergyFloorDb)
          ) {
            nativeNoiseFloorDb =
              nativeNoiseFloorDb === null
                ? db
                : nativeNoiseFloorDb * 0.9 + db * 0.1;
            adaptiveNativeEnergyFloorDb = clamp(
              nativeNoiseFloorDb + cfg.nativeTenVadNoiseMarginDb,
              cfg.nativeTenVadMinEnergyFloorDb,
              cfg.nativeTenVadMaxEnergyFloorDb,
            );
          }

          const canStartDuringCalibration =
            !isCalibrating || db >= cfg.positiveSpeechThreshold;
          const hasEnoughEnergy =
            db >= adaptiveNativeEnergyFloorDb && canStartDuringCalibration;
          const isQuiet = db < cfg.negativeSpeechThreshold;
          processDecision(
            db,
            result.isSpeech && hasEnoughEnergy,
            !result.isSpeech || isQuiet,
          );
        }
      })
      .catch((error) => {
        console.warn("[VAD] TEN VAD frame failed, using energy VAD", error);
        processDecision(
          db,
          db >= cfg.positiveSpeechThreshold,
          db < cfg.negativeSpeechThreshold,
        );
      });
  }

  function reset() {
    speechFrames = 0;
    silenceFrames = 0;
    speaking = false;
    adaptiveNativeEnergyFloorDb = cfg.nativeTenVadEnergyFloorDb;
    nativeNoiseFloorDb = null;
    nativeCalibrationDbs = [];
    if (useNativeTenVad) {
      nativeQueue = nativeQueue
        .then(() => nativeTenVad!.reset())
        .catch((error) => {
          console.warn("[VAD] TEN VAD reset failed", error);
        });
    }
  }

  function destroy() {
    speechFrames = 0;
    silenceFrames = 0;
    speaking = false;
    adaptiveNativeEnergyFloorDb = cfg.nativeTenVadEnergyFloorDb;
    nativeNoiseFloorDb = null;
    nativeCalibrationDbs = [];
    if (useNativeTenVad) {
      nativeQueue = nativeQueue
        .then(() => nativeTenVad!.destroy())
        .catch((error) => {
          console.warn("[VAD] TEN VAD destroy failed", error);
        })
        .then(() => {
          nativeReady = false;
        });
    }
  }

  function pause() {
    paused = true;
  }

  function resume() {
    paused = false;
    reset();
  }

  return {
    processFrame,
    reset,
    destroy,
    pause,
    resume,
    get isSpeaking() {
      return speaking;
    },
    get isPaused() {
      return paused;
    },
  };
}
