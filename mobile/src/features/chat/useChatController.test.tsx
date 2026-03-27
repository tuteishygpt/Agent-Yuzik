import React from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

import { useChatController } from "./useChatController";

describe("useChatController", () => {
  function getTextContent(renderer: TestRenderer.ReactTestRenderer): string {
    return renderer.root
      .findAllByType(Text)
      .map((node) => String(node.props.children ?? ""))
      .join(" ");
  }

  it("hydrates chat history on mount", async () => {
    const getHistory = jest.fn().mockResolvedValue([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ]);

    const observed: { current: ReturnType<typeof useChatController> | null } = {
      current: null,
    };

    function Probe() {
      observed.current = useChatController({
        api: {
          getHistory,
          clearHistory: jest.fn(),
          sendMessage: jest.fn(),
        } as never,
      });

      return (
        <Text>
          {observed.current.messages.map((message) => message.content).join(" | ")}
        </Text>
      );
    }

    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<Probe />);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getHistory).toHaveBeenCalledTimes(1);
    expect(getTextContent(renderer)).toContain("Hello");
    expect(getTextContent(renderer)).toContain("Hi there");
  });

  it("clears hydrated history through the controller action", async () => {
    const getHistory = jest.fn().mockResolvedValue([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ]);
    const clearHistory = jest.fn().mockResolvedValue({ status: "ok" });

    const observed: { current: ReturnType<typeof useChatController> | null } = {
      current: null,
    };

    function Probe() {
      observed.current = useChatController({
        api: {
          getHistory,
          clearHistory,
          sendMessage: jest.fn(),
        } as never,
      });

      return (
        <Text>
          {observed.current.messages.map((message) => message.content).join(" | ")}
        </Text>
      );
    }

    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<Probe />);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await observed.current?.clearHistory();
    });

    expect(clearHistory).toHaveBeenCalledTimes(1);
    expect(getTextContent(renderer)).toBe("");
  });

  it("resolves assistant artifacts into cached local previews", async () => {
    const sendMessage = jest.fn().mockResolvedValue({
      text: "Here is the image",
      audio: null,
      image: "/api/files/artifact-1",
    });
    const resolveArtifact = jest.fn().mockResolvedValue({
      localUri: "file:///cache/artifact-1.png",
      presentation: "preview",
      openInSystem: jest.fn(),
      share: jest.fn(),
    });

    const observed: { current: ReturnType<typeof useChatController> | null } = {
      current: null,
    };

    function Probe() {
      observed.current = useChatController({
        api: {
          getHistory: jest.fn().mockResolvedValue([]),
          clearHistory: jest.fn(),
          createArtifactRequest: jest.fn(),
          sendMessage,
        } as never,
        artifactFetcher: {
          resolveArtifact,
        },
      });

      return (
        <Text>
          {observed.current.messages
            .map((message) => message.artifact?.localUri ?? message.content)
            .join(" | ")}
        </Text>
      );
    }

    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<Probe />);
    });

    await act(async () => {
      observed.current?.setDraftText("show me a chart");
    });

    await act(async () => {
      await observed.current?.sendMessage();
    });

    expect(resolveArtifact).toHaveBeenCalledWith({
      artifactId: "artifact-1",
      mimeType: "image/*",
      filename: "artifact-1.png",
    });
    expect(getTextContent(renderer)).toContain("file:///cache/artifact-1.png");
  });
});
