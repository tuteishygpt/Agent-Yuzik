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

  it("resolves assistant artifacts returned as signed storage urls", async () => {
    const signedUrl = "https://storage.example/object/sign/assistant-artifacts/file.png?token=abc";
    const sendMessage = jest.fn().mockResolvedValue({
      text: "Here is the image",
      audio: null,
      image: signedUrl,
    });
    const resolveArtifact = jest.fn().mockResolvedValue({
      localUri: "file:///cache/signed-image.png",
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
      artifactId: expect.stringMatching(/^url-/),
      sourceUrl: signedUrl,
      mimeType: "image/*",
      filename: expect.stringMatching(/^url-.*\.png$/),
    });
    expect(getTextContent(renderer)).toContain("file:///cache/signed-image.png");
  });

  it("clears the draft and shows the user message while the response is pending", async () => {
    let resolveResponse!: (value: { text: string; audio: null; image: null }) => void;
    const sendMessage = jest.fn(
      () =>
        new Promise<{ text: string; audio: null; image: null }>((resolve) => {
          resolveResponse = resolve;
        }),
    );

    const observed: { current: ReturnType<typeof useChatController> | null } = {
      current: null,
    };

    function Probe() {
      observed.current = useChatController({
        api: {
          getHistory: jest.fn().mockResolvedValue([]),
          clearHistory: jest.fn(),
          sendMessage,
        } as never,
      });

      return (
        <Text>
          {[
            `draft:${observed.current.draftText}`,
            `sending:${observed.current.isSending}`,
            observed.current.messages.map((message) => message.content).join(" | "),
          ].join(" / ")}
        </Text>
      );
    }

    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<Probe />);
    });

    await act(async () => {
      observed.current?.setDraftText("hello");
    });

    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = observed.current!.sendMessage();
    });

    expect(getTextContent(renderer)).toContain("draft: / sending:true / hello");

    await act(async () => {
      resolveResponse({ text: "answer", audio: null, image: null });
      await sendPromise;
    });

    expect(getTextContent(renderer)).toContain("hello | answer");
  });

  it("plays assistant audio artifacts after they are cached", async () => {
    const sendMessage = jest.fn().mockResolvedValue({
      text: "",
      audio: "/api/files/audio-1",
      image: null,
    });
    const resolveArtifact = jest.fn().mockResolvedValue({
      localUri: "file:///cache/audio-1.mp3",
      presentation: "preview",
      openInSystem: jest.fn(),
      share: jest.fn(),
    });
    const playAudioArtifact = jest.fn().mockResolvedValue(undefined);

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
        playAudioArtifact,
      });

      return (
        <Text>
          {observed.current.messages
            .map((message) => message.artifact?.localUri ?? message.content)
            .join(" | ")}
        </Text>
      );
    }

    await act(async () => {
      TestRenderer.create(<Probe />);
    });

    await act(async () => {
      observed.current?.setDraftText("say this");
    });

    await act(async () => {
      await observed.current?.sendMessage();
    });

    expect(playAudioArtifact).toHaveBeenCalledWith("file:///cache/audio-1.mp3");
  });

  it("uses a fresh cache key for repeated legacy audio artifact names", async () => {
    const sendMessage = jest.fn().mockResolvedValue({
      text: "",
      audio: "/api/files/tts_output.wav",
      image: null,
    });
    const resolveArtifact = jest
      .fn()
      .mockResolvedValueOnce({
        localUri: "file:///cache/tts-output-first.wav",
        presentation: "preview",
        openInSystem: jest.fn(),
        share: jest.fn(),
      })
      .mockResolvedValueOnce({
        localUri: "file:///cache/tts-output-second.wav",
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
        playAudioArtifact: jest.fn().mockResolvedValue(undefined),
      });

      return <Text>{observed.current.messages.length}</Text>;
    }

    await act(async () => {
      TestRenderer.create(<Probe />);
    });

    await act(async () => {
      observed.current?.setDraftText("first audio");
    });
    await act(async () => {
      await observed.current?.sendMessage();
    });

    await act(async () => {
      observed.current?.setDraftText("second audio");
    });
    await act(async () => {
      await observed.current?.sendMessage();
    });

    expect(resolveArtifact).toHaveBeenCalledTimes(2);
    expect(resolveArtifact).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        artifactId: "tts_output.wav",
        cacheKey: expect.stringMatching(/^assistant-.*-tts_output\.wav$/),
      }),
    );
    expect(resolveArtifact).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        artifactId: "tts_output.wav",
        cacheKey: expect.stringMatching(/^assistant-.*-tts_output\.wav$/),
      }),
    );
    expect(resolveArtifact.mock.calls[0][0].cacheKey).not.toBe(
      resolveArtifact.mock.calls[1][0].cacheKey,
    );
  });

  it("ignores duplicate sends while the first response is still pending", async () => {
    const resolvers: Array<
      (value: { text: string; audio: null; image: null }) => void
    > = [];
    const sendMessage = jest.fn(
      () =>
        new Promise<{ text: string; audio: null; image: null }>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const observed: { current: ReturnType<typeof useChatController> | null } = {
      current: null,
    };

    function Probe() {
      observed.current = useChatController({
        api: {
          getHistory: jest.fn().mockResolvedValue([]),
          clearHistory: jest.fn(),
          sendMessage,
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
      observed.current?.setDraftText("hello");
    });

    let firstSend!: Promise<void>;
    let duplicateSend!: Promise<void>;

    act(() => {
      firstSend = observed.current!.sendMessage();
      duplicateSend = observed.current!.sendMessage();
    });

    await act(async () => {
      resolvers.forEach((resolve, index) => {
        resolve({ text: `answer ${index + 1}`, audio: null, image: null });
      });
      await firstSend;
      await duplicateSend;
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(getTextContent(renderer)).toBe("hello | answer 1");
  });

  it("passes browser blob voice attachments through to the chat api", async () => {
    const sendMessage = jest.fn().mockResolvedValue({
      text: "voice received",
      audio: null,
      image: null,
    });
    const voiceBlob = new Blob(["RIFF"], { type: "audio/wav" });

    const observed: { current: ReturnType<typeof useChatController> | null } = {
      current: null,
    };

    function Probe() {
      observed.current = useChatController({
        api: {
          getHistory: jest.fn().mockResolvedValue([]),
          clearHistory: jest.fn(),
          sendMessage,
        } as never,
      });

      return (
        <Text>
          {observed.current.messages.map((message) => message.content).join(" | ")}
        </Text>
      );
    }

    await act(async () => {
      TestRenderer.create(<Probe />);
    });

    await act(async () => {
      observed.current?.setAttachment({
        uri: "blob:yuzik-voice-message",
        name: "voice-message.wav",
        mimeType: "audio/wav",
        blob: voiceBlob,
      });
    });

    await act(async () => {
      await observed.current?.sendMessage();
    });

    expect(sendMessage).toHaveBeenCalledWith({
      text: "",
      files: [
        {
          uri: "blob:yuzik-voice-message",
          name: "voice-message.wav",
          type: "audio/wav",
          blob: voiceBlob,
        },
      ],
    });
  });

  it("renders sent voice attachments as audio artifacts without the generated filename", async () => {
    const sendMessage = jest.fn().mockResolvedValue({
      text: "voice received",
      audio: null,
      image: null,
    });
    const voiceBlob = new Blob(["RIFF"], { type: "audio/wav" });

    const observed: { current: ReturnType<typeof useChatController> | null } = {
      current: null,
    };

    function Probe() {
      observed.current = useChatController({
        api: {
          getHistory: jest.fn().mockResolvedValue([]),
          clearHistory: jest.fn(),
          sendMessage,
        } as never,
      });

      return (
        <Text>
          {observed.current.messages
            .map((message) =>
              [
                `content:${message.content}`,
                `artifact:${message.artifact?.kind ?? "none"}`,
                `uri:${message.artifact?.localUri ?? "none"}`,
              ].join("/"),
            )
            .join(" | ")}
        </Text>
      );
    }

    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<Probe />);
    });

    await act(async () => {
      observed.current?.setAttachment({
        uri: "blob:yuzik-voice-message",
        name: "voice-message-1783178911839.wav",
        mimeType: "audio/wav",
        blob: voiceBlob,
      });
    });

    await act(async () => {
      await observed.current?.sendMessage();
    });

    expect(getTextContent(renderer)).toContain(
      "content:/artifact:audio/uri:blob:yuzik-voice-message",
    );
    expect(getTextContent(renderer)).not.toContain("voice-message-1783178911839.wav");
  });
});
