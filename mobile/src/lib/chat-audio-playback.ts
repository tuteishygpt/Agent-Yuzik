type ChatAudioSound = {
  play: () => void;
  pause: () => void;
  remove: () => void;
  addListener?: (
    eventName: "playbackStatusUpdate",
    listener: (status: { didJustFinish?: boolean; isLoaded?: boolean }) => void,
  ) => { remove: () => void };
};

type ChatAudioModule = {
  AudioPlayer?: new (
    source: { uri: string },
    updateInterval: number,
    keepAudioSessionActive: boolean,
  ) => ChatAudioSound;
  AudioPlayerWeb?: new (
    source: { uri: string },
    options: { updateInterval: number },
  ) => ChatAudioSound;
};

let currentSound: ChatAudioSound | null = null;
let currentSubscription: { remove: () => void } | null = null;

function cleanupCurrentSound(): void {
  try {
    currentSubscription?.remove();
    currentSound?.pause();
    currentSound?.remove();
  } catch {
    // Playback cleanup must not block the next audio response.
  } finally {
    currentSubscription = null;
    currentSound = null;
  }
}

export async function playChatAudioArtifact(uri: string): Promise<void> {
  cleanupCurrentSound();

  const audioModuleExports = require("expo-audio/build/AudioModule") as {
    default?: unknown;
    AudioPlayerWeb?: unknown;
  };
  const audioModule = (audioModuleExports.default ??
    audioModuleExports) as ChatAudioModule;

  const player = audioModule.AudioPlayer
    ? new audioModule.AudioPlayer({ uri }, 500, false)
    : audioModule.AudioPlayerWeb
      ? new audioModule.AudioPlayerWeb({ uri }, { updateInterval: 500 })
      : null;

  if (!player) {
    throw new Error("Expo audio playback is unavailable.");
  }

  currentSound = player;
  currentSubscription =
    player.addListener?.("playbackStatusUpdate", (status) => {
      if (status.isLoaded !== false && status.didJustFinish) {
        cleanupCurrentSound();
      }
    }) ?? null;

  player.play();
}
