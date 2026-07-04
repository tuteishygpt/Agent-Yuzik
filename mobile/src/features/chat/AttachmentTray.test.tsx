import { StyleSheet, Text } from "react-native";

import { render } from "@/test/render";

import { AttachmentTray } from "./AttachmentTray";

describe("AttachmentTray", () => {
  it("shows a compact voice attachment without visible file metadata", () => {
    const screen = render(
      <AttachmentTray
        attachment={{
          uri: "blob:yuzik-voice-message",
          mimeType: "audio/wav",
          name: "voice-message-1783178911839.wav",
        }}
        onClear={jest.fn()}
      />,
    );

    const visibleText = screen.renderer.root
      .findAllByType(Text)
      .map((node) => String(node.props.children ?? ""))
      .join(" ");

    expect(visibleText).not.toContain("voice-message-1783178911839.wav");
    expect(visibleText).not.toContain("audio/wav");
    expect(
      screen.renderer.root.findByProps({ testID: "attachment-voice-waveform" }),
    ).toBeTruthy();
  });

  it("keeps the remove action usable as a mobile touch target", () => {
    const screen = render(
      <AttachmentTray
        attachment={{
          uri: "file:///cache/image.png",
          mimeType: "image/png",
          name: "image.png",
        }}
        onClear={jest.fn()}
      />,
    );

    const clearButton = screen.renderer.root.findByProps({
      accessibilityLabel: "Remove attachment",
    });
    const clearButtonStyle = StyleSheet.flatten(clearButton.props.style);

    expect(clearButtonStyle.minHeight).toBeGreaterThanOrEqual(44);
    expect(clearButtonStyle.minWidth).toBeGreaterThanOrEqual(44);
  });
});
