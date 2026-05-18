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
