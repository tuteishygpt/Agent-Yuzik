/**
 * Energy-based Voice Activity Detection inspired by WebRTC VAD.
 * Uses audio metering (dB) levels from the recording adapter to detect speech boundaries.
 */

export type VadConfig = {
  /** dB threshold to trigger speech start (e.g. -30). Higher = less sensitive. */
  positiveSpeechThreshold: number;
  /** dB threshold to trigger speech end (e.g. -50). Lower = requires more silence. */
  negativeSpeechThreshold: number;
  /** Consecutive silent frames before speech is considered ended. */
  redemptionFrames: number;
  /** Minimum speech frames before a segment is considered valid. */
  minSpeechFrames: number;
};

export type VadCallbacks = {
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
  onFrameProcessed?: (db: number, isSpeech: boolean) => void;
};

export type VadInstance = {
  processFrame: (db: number) => void;
  reset: () => void;
  pause: () => void;
  resume: () => void;
  readonly isSpeaking: boolean;
  readonly isPaused: boolean;
};

const DEFAULT_CONFIG: VadConfig = {
  positiveSpeechThreshold: -40,
  negativeSpeechThreshold: -42,
  redemptionFrames: 8,
  minSpeechFrames: 3,
};

export function createVad(
  callbacks: VadCallbacks,
  config: Partial<VadConfig> = {},
): VadInstance {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let speechFrames = 0;
  let silenceFrames = 0;
  let speaking = false;
  let paused = false;

  function processFrame(db: number) {
    if (paused) return;

    const isSpeech = db >= cfg.positiveSpeechThreshold;
    callbacks.onFrameProcessed?.(db, isSpeech);

    if (speaking) {
      if (db < cfg.negativeSpeechThreshold) {
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

  function reset() {
    speechFrames = 0;
    silenceFrames = 0;
    speaking = false;
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
