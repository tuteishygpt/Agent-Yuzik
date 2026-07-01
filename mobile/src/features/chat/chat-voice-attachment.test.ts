import { createVoiceAttachmentFromWavBytes } from "./chat-voice-attachment";

describe("chat voice attachment", () => {
  it("writes recorded WAV bytes to cache as a web-compatible voice-message attachment", async () => {
    const writeAsStringAsync = jest.fn().mockResolvedValue(undefined);

    const attachment = await createVoiceAttachmentFromWavBytes({
      wavBytes: new Uint8Array([0x52, 0x49, 0x46, 0x46]),
      fileSystem: {
        cacheDirectory: "file:///cache/",
        EncodingType: { Base64: "base64" },
        writeAsStringAsync,
      },
      now: () => 1234567890,
    });

    expect(writeAsStringAsync).toHaveBeenCalledWith(
      "file:///cache/voice-message-1234567890.wav",
      "UklGRg==",
      { encoding: "base64" },
    );
    expect(attachment).toEqual({
      uri: "file:///cache/voice-message-1234567890.wav",
      name: "voice-message-1234567890.wav",
      mimeType: "audio/wav",
    });
  });

  it("rejects missing recorded audio bytes", async () => {
    await expect(
      createVoiceAttachmentFromWavBytes({
        wavBytes: null,
        fileSystem: {
          cacheDirectory: "file:///cache/",
          EncodingType: { Base64: "base64" },
          writeAsStringAsync: jest.fn(),
        },
      }),
    ).rejects.toThrow("Voice recording did not produce audio.");
  });
});
