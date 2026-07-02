import { useEffect, useRef } from "react";

import {
  createVoicePlaybackAdapter,
  type VoicePlaybackAdapter,
  type VoicePlaybackBytesOptions,
} from "@/lib/audio-playback";

export type VoicePlaybackControls = {
  prepare: () => void;
  play: (
    bytes: Uint8Array,
    options?: VoicePlaybackBytesOptions,
    waitFor?: Promise<unknown>,
  ) => Promise<void>;
  stop: () => void;
  release: () => void;
};

export function useVoicePlayback(
  injected?: VoicePlaybackAdapter,
): VoicePlaybackControls {
  const playbackRef = useRef<VoicePlaybackAdapter | null>(injected ?? null);

  function getPlayback(): VoicePlaybackAdapter {
    playbackRef.current ??= createVoicePlaybackAdapter();
    return playbackRef.current;
  }

  useEffect(() => {
    return () => {
      playbackRef.current?.release();
    };
  }, []);

  return {
    prepare: () => getPlayback().prepare(),
    play: async (bytes, options, waitFor) => {
      await waitFor;
      await getPlayback().playBytes(bytes, options);
    },
    stop: () => playbackRef.current?.stop(),
    release: () => playbackRef.current?.release(),
  };
}
