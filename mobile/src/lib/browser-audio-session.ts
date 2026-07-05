type BrowserAudioSessionType =
  | "auto"
  | "playback"
  | "transient"
  | "transient-solo"
  | "ambient"
  | "play-and-record";

type BrowserAudioSession = {
  type: BrowserAudioSessionType | string;
};

type BrowserAudioSessionNavigator = Navigator & {
  audioSession?: BrowserAudioSession;
};

function setBrowserAudioSessionType(type: BrowserAudioSessionType): void {
  try {
    const audioSession = (globalThis.navigator as
      | BrowserAudioSessionNavigator
      | undefined)?.audioSession;
    if (audioSession) {
      audioSession.type = type;
    }
  } catch {
    // Safari may expose this experimental API with platform-specific limits.
  }
}

export function prepareBrowserAudioSessionForRecording(): void {
  setBrowserAudioSessionType("play-and-record");
}

export function markBrowserAudioSessionRecording(): void {
  setBrowserAudioSessionType("play-and-record");
}

export function resetBrowserAudioSessionAfterRecording(): void {
  setBrowserAudioSessionType("playback");
}

export function prepareBrowserAudioSessionForPlayback(): void {
  setBrowserAudioSessionType("playback");
}
