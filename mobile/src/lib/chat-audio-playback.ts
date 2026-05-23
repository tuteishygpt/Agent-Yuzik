type ChatAudioSound = {
  play: () => void;
  pause: () => void;
  remove: () => void;
  addListener?: (
    eventName: "playbackStatusUpdate",
    listener: (status: { didJustFinish?: boolean; isLoaded?: boolean }) => void,
  ) => { remove: () => void };
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

  const audioModule = require("expo-audio/build/AudioModule").default as {
    AudioPlayer?: new (
      source: { uri: string },
      updateInterval: number,
      keepAudioSessionActive: boolean,
    ) => ChatAudioSound;
  };

  if (!audioModule.AudioPlayer) {
    throw new Error("Expo audio playback is unavailable.");
  }

  const player = new audioModule.AudioPlayer({ uri }, 500, false);
  currentSound = player;
  currentSubscription =
    player.addListener?.("playbackStatusUpdate", (status) => {
      if (status.isLoaded !== false && status.didJustFinish) {
        cleanupCurrentSound();
      }
    }) ?? null;

  player.play();
}
