import * as DefaultFileSystem from "expo-file-system/legacy";

import { bytesToBase64 } from "@/lib/audio-pcm-format";
import type { ChatAttachment } from "@/lib/file-picker";

type VoiceAttachmentFileSystem = {
  cacheDirectory: string | null;
  EncodingType: { Base64: string };
  writeAsStringAsync: (
    uri: string,
    contents: string,
    options: { encoding: string },
  ) => Promise<void>;
};

type CreateVoiceAttachmentOptions = {
  wavBytes: Uint8Array | null;
  fileSystem?: VoiceAttachmentFileSystem;
  now?: () => number;
};

export async function createVoiceAttachmentFromWavBytes({
  wavBytes,
  fileSystem,
  now = Date.now,
}: CreateVoiceAttachmentOptions): Promise<ChatAttachment> {
  if (!wavBytes?.byteLength) {
    throw new Error("Voice recording did not produce audio.");
  }

  const cacheDirectory = fileSystem?.cacheDirectory ?? DefaultFileSystem.cacheDirectory;
  if (!cacheDirectory) {
    throw new Error("File system cache directory is unavailable.");
  }

  const name = `voice-message-${now()}.wav`;
  const uri = `${cacheDirectory.replace(/\/+$/, "")}/${name}`;
  if (fileSystem) {
    await fileSystem.writeAsStringAsync(uri, bytesToBase64(wavBytes), {
      encoding: fileSystem.EncodingType.Base64,
    });
  } else {
    await DefaultFileSystem.writeAsStringAsync(uri, bytesToBase64(wavBytes), {
      encoding: DefaultFileSystem.EncodingType.Base64,
    });
  }

  return {
    uri,
    name,
    mimeType: "audio/wav",
  };
}
