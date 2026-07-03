import { useRef, useCallback } from "react";

import {
  createVad,
  type VadConfig,
  type VadInstance,
  type VadRuntime,
} from "@/lib/vad";

export type VoiceVadControls = {
  start: (
    onSpeechStart: () => void,
    onSpeechEnd: () => void,
    onRuntimeChange?: (runtime: VadRuntime) => void,
  ) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  feedMeteringFrame: (db: number, pcm16?: Uint8Array) => void;
};

export function useVoiceVad(config?: Partial<VadConfig>): VoiceVadControls {
  const vadRef = useRef<VadInstance | null>(null);

  const start = useCallback(
    (
      onSpeechStart: () => void,
      onSpeechEnd: () => void,
      onRuntimeChange?: (runtime: VadRuntime) => void,
    ) => {
      vadRef.current = createVad(
        { onSpeechStart, onSpeechEnd, onRuntimeChange },
        config,
      );
    },
    [config],
  );

  const stop = useCallback(() => {
    vadRef.current?.destroy();
    vadRef.current = null;
  }, []);

  const pause = useCallback(() => {
    vadRef.current?.pause();
  }, []);

  const resume = useCallback(() => {
    vadRef.current?.resume();
  }, []);

  const feedMeteringFrame = useCallback((db: number, pcm16?: Uint8Array) => {
    vadRef.current?.processFrame(db, pcm16);
  }, []);

  return { start, stop, pause, resume, feedMeteringFrame };
}
