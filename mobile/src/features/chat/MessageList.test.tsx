import React from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

import { MessageList } from "./MessageList";

describe("MessageList", () => {
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

  it("renders a play button for audio artifacts", async () => {
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

    await act(async () => {
      renderer.root
        .findByProps({ testID: "chat-audio-play-button" })
        .props.onPress();
    });

    expect(play).toHaveBeenCalledTimes(1);
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
});

function readText(renderer: TestRenderer.ReactTestRenderer): string {
  return renderer.root
    .findAllByType(Text)
    .map((node) => String(node.props.children ?? ""))
    .join(" ");
}
