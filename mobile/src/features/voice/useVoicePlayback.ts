import { useEffect, useRef } from "react";

import {
  createVoicePlaybackAdapter,
  type VoicePlaybackAdapter,
} from "@/lib/audio-playback";

export type VoicePlaybackControls = {
  play: (
    bytes: Uint8Array,
    options?: { sampleRate?: number },
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
    play: (bytes, options) => getPlayback().playBytes(bytes, options),
    stop: () => playbackRef.current?.stop(),
    release: () => playbackRef.current?.release(),
  };
}
