import { useRef, useCallback } from "react";

import { createVad, type VadConfig, type VadInstance } from "@/lib/vad";

export type VoiceVadControls = {
  start: (onSpeechStart: () => void, onSpeechEnd: () => void) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  feedMeteringFrame: (db: number, pcm16?: Uint8Array) => void;
};

export function useVoiceVad(config?: Partial<VadConfig>): VoiceVadControls {
  const vadRef = useRef<VadInstance | null>(null);

  const start = useCallback(
    (onSpeechStart: () => void, onSpeechEnd: () => void) => {
      vadRef.current = createVad(
        { onSpeechStart, onSpeechEnd },
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

  const frameCountRef = useRef(0);

  const feedMeteringFrame = useCallback((db: number, pcm16?: Uint8Array) => {
    frameCountRef.current++;
    if (frameCountRef.current <= 20 || frameCountRef.current % 50 === 0) {
      console.log(`[VAD] frame #${frameCountRef.current} db=${db}`);
    }
    vadRef.current?.processFrame(db, pcm16);
  }, []);

  return { start, stop, pause, resume, feedMeteringFrame };
}
