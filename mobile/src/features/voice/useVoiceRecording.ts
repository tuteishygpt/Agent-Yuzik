import { useRef } from "react";

import {
  createDefaultVoiceRecorderAdapter,
  type MeteringCallback,
  type VoiceRecorderAdapter,
} from "@/lib/audio-recording";

export type VoiceRecordingControls = {
  start: (onMetering?: MeteringCallback) => Promise<void>;
  stop: () => Promise<{ wavBytes: Uint8Array | null }>;
};

export function useVoiceRecording(
  injected?: VoiceRecorderAdapter,
): VoiceRecordingControls {
  const recorderRef = useRef<VoiceRecorderAdapter | null>(injected ?? null);

  function getRecorder(): VoiceRecorderAdapter {
    recorderRef.current ??= createDefaultVoiceRecorderAdapter();
    return recorderRef.current;
  }

  return {
    start: async (onMetering?: MeteringCallback) => {
      const recorder = getRecorder();
      await recorder.prepare();
      await recorder.start(onMetering);
    },
    stop: async () => {
      const recorder = recorderRef.current;
      if (!recorder) {
        return { wavBytes: null };
      }
      const result = await recorder.stop();
      return { wavBytes: result.wavBytes ?? null };
    },
  };
}
