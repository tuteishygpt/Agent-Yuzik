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
  const preparedRef = useRef(false);

  function getRecorder(): VoiceRecorderAdapter {
    recorderRef.current ??= createDefaultVoiceRecorderAdapter();
    return recorderRef.current;
  }

  return {
    start: async (onMetering?: MeteringCallback) => {
      const recorder = getRecorder();
      if (!preparedRef.current) {
        await recorder.prepare();
        preparedRef.current = true;
      }
      await recorder.start(onMetering);
    },
    stop: async () => {
      const recorder = recorderRef.current;
      if (!recorder) {
        return { wavBytes: null };
      }
      const result = await recorder.stop();
      preparedRef.current = false;
      return { wavBytes: result.wavBytes ?? null };
    },
  };
}
