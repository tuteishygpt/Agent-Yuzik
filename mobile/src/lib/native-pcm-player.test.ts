describe("native PCM player wrapper", () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock("react-native");
  });

  it("pushes Float32 PCM bytes to the Android native module as base64", async () => {
    const pushFloat32Pcm = jest.fn().mockResolvedValue(undefined);
    jest.doMock("react-native", () => ({
      NativeModules: {
        NativePcmPlayer: {
          pushFloat32Pcm,
          reset: jest.fn().mockResolvedValue(undefined),
          stop: jest.fn().mockResolvedValue(undefined),
        },
      },
      Platform: { OS: "android" },
    }));

    const { createNativePcmPlayer } = require("./native-pcm-player") as typeof import("./native-pcm-player");
    const player = createNativePcmPlayer();

    await player.pushFloat32Pcm(new Uint8Array([1, 2, 3, 4]), 24000, 420);

    expect(player.isAvailable()).toBe(true);
    expect(pushFloat32Pcm).toHaveBeenCalledWith("AQIDBA==", 24000, 420);
  });

  it("sanitizes unsafe Float32 PCM samples before native playback", async () => {
    const pushFloat32Pcm = jest.fn().mockResolvedValue(undefined);
    jest.doMock("react-native", () => ({
      NativeModules: {
        NativePcmPlayer: {
          pushFloat32Pcm,
          reset: jest.fn().mockResolvedValue(undefined),
          stop: jest.fn().mockResolvedValue(undefined),
        },
      },
      Platform: { OS: "android" },
    }));

    const { createNativePcmPlayer } = require("./native-pcm-player") as typeof import("./native-pcm-player");
    const player = createNativePcmPlayer();
    const bytes = new Uint8Array(6 * 4);
    const inputView = new DataView(bytes.buffer);
    [1.25, -1.25, Number.NaN, Infinity, -Infinity, 0.5].forEach(
      (sample, index) => inputView.setFloat32(index * 4, sample, true),
    );

    await player.pushFloat32Pcm(bytes, 24000, 420);

    const payload = pushFloat32Pcm.mock.calls[0][0] as string;
    const sanitizedBytes = Buffer.from(payload, "base64");
    const outputView = new DataView(
      sanitizedBytes.buffer,
      sanitizedBytes.byteOffset,
      sanitizedBytes.byteLength,
    );
    const samples = Array.from({ length: 6 }, (_value, index) =>
      outputView.getFloat32(index * 4, true),
    );

    expect(samples).toEqual([1, -1, 0, 0, 0, 0.5]);
  });

  it("reports unavailable off Android", async () => {
    jest.doMock("react-native", () => ({
      NativeModules: {
        NativePcmPlayer: {
          pushFloat32Pcm: jest.fn(),
          reset: jest.fn(),
          stop: jest.fn(),
        },
      },
      Platform: { OS: "ios" },
    }));

    const { createNativePcmPlayer } = require("./native-pcm-player") as typeof import("./native-pcm-player");

    expect(createNativePcmPlayer().isAvailable()).toBe(false);
  });
});
