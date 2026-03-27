import { Buffer } from "buffer";

import FileSystem from "expo-file-system/legacy";

export type VoicePlaybackAdapter = {
  playBytes: (bytes: Uint8Array) => Promise<void>;
  stop: () => void;
  release: () => void;
  isPlaying: () => boolean;
};

type VoicePlaybackOptions = {
  createPlayer?: (uri: string) => {
    play: () => void;
    pause: () => void;
    playing?: boolean;
  };
  cacheDirectory?: string | null;
};

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function writeBytesToCache(
  bytes: Uint8Array,
  cacheDirectory: string | null,
): Promise<string> {
  const directory = cacheDirectory ?? FileSystem.cacheDirectory;

  if (!directory) {
    throw new Error("File system cache directory is unavailable.");
  }

  const uri = `${directory.replace(/\/+$/, "")}/yuzik-voice-response.wav`;
  await FileSystem.writeAsStringAsync(uri, bytesToBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });

  return uri;
}

export function createVoicePlaybackAdapter(
  options: VoicePlaybackOptions = {},
): VoicePlaybackAdapter {
  const createPlayer =
    options.createPlayer ??
    ((uri: string) => {
      const expoAudio = require("expo-audio") as {
        createAudioPlayer: (source: string) => {
          play: () => void;
          pause: () => void;
          playing?: boolean;
        };
      };

      return expoAudio.createAudioPlayer(uri);
    });
  let player: ReturnType<typeof createPlayer> | null = null;

  return {
    async playBytes(bytes: Uint8Array) {
      const uri = await writeBytesToCache(bytes, options.cacheDirectory ?? null);

      player?.pause();
      player = createPlayer(uri);
      player.play();
    },
    stop() {
      player?.pause();
    },
    release() {
      player?.pause();
      player = null;
    },
    isPlaying() {
      return Boolean(player?.playing);
    },
  };
}
