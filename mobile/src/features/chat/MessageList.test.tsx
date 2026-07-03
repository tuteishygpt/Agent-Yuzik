import React from "react";
import { StyleSheet, Text, View } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const mockAudioPlayer = {
  play: jest.fn(),
  pause: jest.fn(),
};
let mockAudioStatus = {
  duration: 83,
  playing: false,
};

jest.mock("expo-audio", () => ({
  useAudioPlayer: jest.fn(() => mockAudioPlayer),
  useAudioPlayerStatus: jest.fn(() => mockAudioStatus),
}));

import { MessageList } from "./MessageList";

describe("MessageList", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockAudioStatus = {
      duration: 83,
      playing: false,
    };
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it("shows a typing indicator while a chat response is pending", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        <MessageList
          isSending
          messages={[
            {
              id: "user-1",
              role: "user",
              content: "hello",
              artifact: null,
              artifactError: null,
            },
          ]}
        />,
      );
    });

    expect(renderer.root.findByProps({ testID: "chat-typing-indicator" })).toBeTruthy();

    await act(async () => {
      renderer.unmount();
    });
  });

  it("renders audio artifacts with real duration and expo-audio play state", async () => {
    const play = jest.fn().mockResolvedValue(undefined);
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        <MessageList
          messages={[
            {
              id: "assistant-1",
              role: "assistant",
              content: "",
              artifact: {
                kind: "audio",
                localUri: "file:///cache/audio.wav",
                presentation: "preview",
                openInSystem: jest.fn(),
                share: jest.fn(),
                play,
              },
              artifactError: null,
            } as any,
          ]}
        />,
      );
    });

    expect(readText(renderer)).toContain("01:23");
    expect(readText(renderer)).not.toContain("chat.audioCached");
    expect(readText(renderer)).not.toContain("chat.play");
    expect(renderer.root.findByProps({ testID: "chat-audio-waveform" })).toBeTruthy();
    expect(renderer.root.findByProps({ testID: "chat-audio-play-icon" })).toBeTruthy();

    await act(async () => {
      renderer.root
        .findByProps({ testID: "chat-audio-play-button" })
        .props.onPress();
    });

    expect(mockAudioPlayer.play).toHaveBeenCalledTimes(1);
    expect(play).not.toHaveBeenCalled();

    mockAudioStatus = {
      duration: 83,
      playing: true,
    };

    await act(async () => {
      renderer.update(
        <MessageList
          messages={[
            {
              id: "assistant-1",
              role: "assistant",
              content: "",
              artifact: {
                kind: "audio",
                localUri: "file:///cache/audio.wav",
                presentation: "preview",
                openInSystem: jest.fn(),
                share: jest.fn(),
                play,
              },
              artifactError: null,
            } as any,
          ]}
        />,
      );
    });

    expect(renderer.root.findByProps({ testID: "chat-audio-pause-icon" })).toBeTruthy();

    await act(async () => {
      renderer.root
        .findByProps({ testID: "chat-audio-play-button" })
        .props.onPress();
    });

    expect(mockAudioPlayer.pause).toHaveBeenCalledTimes(1);
  });

  it("hides open and share artifact actions and expands image previews", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        <MessageList
          messages={[
            {
              id: "assistant-image-1",
              role: "assistant",
              content: "",
              artifact: {
                kind: "image",
                localUri: "blob:yuzik-image",
                presentation: "preview",
                openInSystem: jest.fn(),
                share: jest.fn(),
              },
              artifactError: null,
            } as any,
          ]}
        />,
      );
    });

    expect(readText(renderer)).not.toContain("chat.open");
    expect(readText(renderer)).not.toContain("chat.share");

    await act(async () => {
      renderer.root
        .findByProps({ testID: "chat-image-preview-button" })
        .props.onPress();
    });

    const fullScreenImage = renderer.root.findByProps({
      testID: "chat-fullscreen-image",
    });
    expect(fullScreenImage.props.source).toEqual({ uri: "blob:yuzik-image" });

    await act(async () => {
      renderer.root
        .findByProps({ accessibilityLabel: "Close image preview" })
        .props.onPress();
    });

    expect(
      renderer.root.findAllByProps({ testID: "chat-fullscreen-image" }),
    ).toHaveLength(0);
  });

  it("renders the Figma start screen prompt chips", async () => {
    const onSelectPrompt = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        <MessageList messages={[]} onSelectPrompt={onSelectPrompt} />,
      );
    });

    const chipLabels = renderer.root
      .findAllByType(Text)
      .map((node) => String(node.props.children ?? ""))
      .filter((label) =>
        ["Патлумач слова", "Ствары выяву", "Практыка мовы"].includes(label),
      );

    expect(chipLabels).toEqual([
      "Патлумач слова",
      "Ствары выяву",
      "Практыка мовы",
    ]);
    expect(readText(renderer)).toContain("Вітаю, я Юзік");
    expect(readText(renderer)).toContain(
      "Я дапамагаю пісаць, гаварыць і ствараць па-беларуску",
    );
  });
  it("keeps the start screen responsive on narrow mobile widths", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<MessageList messages={[]} />);
    });

    const promptGrid = renderer.root
      .findAllByType(View)
      .find((node) => {
        const style = StyleSheet.flatten(node.props.style);
        return style?.flexWrap === "wrap" && style?.rowGap === 12;
      });
    const emptyState = renderer.root
      .findAllByType(View)
      .find((node) => {
        const style = StyleSheet.flatten(node.props.style);
        return style?.alignItems === "center" && style?.paddingTop != null;
      });

    const promptGridStyle = StyleSheet.flatten(promptGrid?.props.style);
    const emptyStateStyle = StyleSheet.flatten(emptyState?.props.style);

    expect(promptGridStyle.width).toBe("100%");
    expect(promptGridStyle.maxWidth).toBeLessThanOrEqual(311);
    expect(emptyStateStyle.paddingTop).toBeLessThanOrEqual(72);
  });
});

function readText(renderer: TestRenderer.ReactTestRenderer): string {
  return renderer.root
    .findAllByType(Text)
    .map((node) => String(node.props.children ?? ""))
    .join(" ");
}
