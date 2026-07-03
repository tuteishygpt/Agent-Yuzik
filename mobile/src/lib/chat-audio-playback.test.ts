const mockPlayer = {
  addListener: jest.fn(),
  play: jest.fn(),
  pause: jest.fn(),
  remove: jest.fn(),
};

const mockCreateAudioPlayer = jest.fn(() => mockPlayer);
const mockCreateAudioPlayerWeb = jest.fn(() => mockPlayer);
const mockAudioModuleDefault: {
  AudioPlayer?: typeof mockCreateAudioPlayer;
  AudioPlayerWeb?: typeof mockCreateAudioPlayerWeb;
} = {
  AudioPlayer: mockCreateAudioPlayer,
};
const mockAudioModuleExports: {
  default?: typeof mockAudioModuleDefault;
  AudioPlayerWeb?: typeof mockCreateAudioPlayerWeb;
} = {
  default: mockAudioModuleDefault,
};

jest.mock("expo-audio/build/AudioModule", () => ({
  __esModule: true,
  get default() {
    return mockAudioModuleExports.default;
  },
  get AudioPlayerWeb() {
    return mockAudioModuleExports.AudioPlayerWeb;
  },
}));

import { playChatAudioArtifact } from "./chat-audio-playback";

describe("chat audio playback", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAudioModuleExports.default = mockAudioModuleDefault;
    delete mockAudioModuleExports.AudioPlayerWeb;
    mockAudioModuleDefault.AudioPlayer = mockCreateAudioPlayer;
    delete mockAudioModuleDefault.AudioPlayerWeb;
  });

  it("plays chat audio through native expo audio", async () => {
    await playChatAudioArtifact("file:///cache/audio.mp3");

    expect(mockCreateAudioPlayer).toHaveBeenCalledWith(
      { uri: "file:///cache/audio.mp3" },
      500,
      false,
    );
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  });

  it("plays chat audio through named web expo audio when default export is absent", async () => {
    delete mockAudioModuleExports.default;
    mockAudioModuleExports.AudioPlayerWeb = mockCreateAudioPlayerWeb;

    await playChatAudioArtifact("blob:chat-audio");

    expect(mockCreateAudioPlayerWeb).toHaveBeenCalledWith(
      { uri: "blob:chat-audio" },
      { updateInterval: 500 },
    );
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  });
});
