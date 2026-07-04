import React from "react";
import { StyleSheet, View } from "react-native";
import { act } from "react-test-renderer";

import { render } from "@/test/render";
import { webTheme } from "@/theme/webTheme";

import { Composer } from "./Composer";

jest.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        "chat.placeholder": "Write a message...",
        "chat.footer": "Yuzik can make mistakes.",
      })[key] ?? key,
  }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 24, left: 0, right: 0, top: 0 }),
}));

describe("Composer", () => {
  it("uses the leading Figma plus action for attachments instead of opening the menu", () => {
    const onAttach = jest.fn();
    const onOpenMenu = jest.fn();

    const screen = render(
      <Composer
        attachment={null}
        draftText=""
        isSending={false}
        onAttach={onAttach}
        onChangeDraftText={jest.fn()}
        onClearAttachment={jest.fn()}
        onOpenMenu={onOpenMenu}
        onSend={jest.fn()}
      />,
    );

    const button = screen.renderer.root.findByProps({
      accessibilityLabel: "Attach file",
    });

    act(() => {
      button.props.onPress();
    });

    expect(onAttach).toHaveBeenCalledTimes(1);
    expect(onOpenMenu).not.toHaveBeenCalled();
    expect(
      screen.renderer.root.findAllByProps({ accessibilityLabel: "Open menu" }),
    ).toHaveLength(0);
  });

  it("keeps bottom controls above Android navigation with stable alignment", () => {
    const screen = render(
      <Composer
        attachment={null}
        draftText=""
        isSending={false}
        onAttach={jest.fn()}
        onChangeDraftText={jest.fn()}
        onClearAttachment={jest.fn()}
        onOpenMenu={jest.fn()}
        onSend={jest.fn()}
      />,
    );

    const views = screen.renderer.root.findAllByType(View);
    const containerStyle = StyleSheet.flatten(views[0].props.style);
    const inputShell = screen.renderer.root.findByProps({
      testID: "chat-composer-input-shell",
    });
    const inputContainerStyle = StyleSheet.flatten(inputShell.props.style);

    expect(containerStyle.paddingBottom).toBe(32);
    expect(inputContainerStyle.minHeight).toBeGreaterThanOrEqual(52);
    expect(inputContainerStyle.flexShrink).toBe(1);
  });

  it("matches the Figma input field without helper footer copy", () => {
    const screen = render(
      <Composer
        attachment={null}
        draftText=""
        isSending={false}
        onAttach={jest.fn()}
        onChangeDraftText={jest.fn()}
        onClearAttachment={jest.fn()}
        onOpenMenu={jest.fn()}
        onSend={jest.fn()}
      />,
    );

    const inputShell = screen.renderer.root.findByProps({
      testID: "chat-composer-input-shell",
    });
    const inputContainerStyle = StyleSheet.flatten(inputShell.props.style);

    expect(inputContainerStyle.minHeight).toBe(webTheme.sizes.inputHeight);
    expect(inputContainerStyle.borderRadius).toBe(webTheme.radii.textBar);
    expect(inputContainerStyle.borderColor).toBe(webTheme.colors.border);
    expect(screen.getTextContent()).not.toContain("Yuzik can make mistakes.");
  });

  it("records voice while the trailing microphone action is held", () => {
    const onSend = jest.fn();
    const onStartVoiceRecording = jest.fn();
    const onStopVoiceRecording = jest.fn();
    const screen = render(
      <Composer
        attachment={null}
        draftText=""
        isSending={false}
        onAttach={jest.fn()}
        onChangeDraftText={jest.fn()}
        onClearAttachment={jest.fn()}
        onOpenMenu={jest.fn()}
        onSend={onSend}
        onStartVoiceRecording={onStartVoiceRecording}
        onStopVoiceRecording={onStopVoiceRecording}
      />,
    );

    const voiceButton = screen.renderer.root.findByProps({
      accessibilityLabel: "Start voice message",
    });

    act(() => {
      voiceButton.props.onPressIn();
      voiceButton.props.onPressOut();
    });

    expect(onStartVoiceRecording).toHaveBeenCalledTimes(1);
    expect(onStopVoiceRecording).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
    expect(
      screen.renderer.root.findAllByProps({ accessibilityLabel: "Open menu" }),
    ).toHaveLength(0);
  });

  it("keeps the microphone glyph compact inside the Figma action circle", () => {
    const screen = render(
      <Composer
        attachment={null}
        draftText=""
        isSending={false}
        onAttach={jest.fn()}
        onChangeDraftText={jest.fn()}
        onClearAttachment={jest.fn()}
        onOpenMenu={jest.fn()}
        onSend={jest.fn()}
        onStartVoiceRecording={jest.fn()}
        onStopVoiceRecording={jest.fn()}
      />,
    );

    const voiceIcon = screen.renderer.root.findByProps({
      testID: "composer-voice-icon",
    });
    const voiceIconStyle = StyleSheet.flatten(voiceIcon.props.style);

    expect(voiceIconStyle.width).toBe(20);
    expect(voiceIconStyle.height).toBe(22);
    expect(screen.getTextContent()).not.toContain("🎙");
  });

  it("shows the recording wave without replacing the held microphone action", () => {
    const onStopVoiceRecording = jest.fn();
    const screen = render(
      <Composer
        attachment={null}
        draftText=""
        isRecordingVoice
        isSending={false}
        onAttach={jest.fn()}
        onChangeDraftText={jest.fn()}
        onClearAttachment={jest.fn()}
        onOpenMenu={jest.fn()}
        onSend={jest.fn()}
        onStartVoiceRecording={jest.fn()}
        onStopVoiceRecording={onStopVoiceRecording}
      />,
    );

    expect(
      screen.renderer.root.findByProps({ testID: "voice-recording-wave" }),
    ).toBeTruthy();

    act(() => {
      screen.renderer.root
        .findByProps({ accessibilityLabel: "Start voice message" })
        .props.onPressOut();
    });

    expect(onStopVoiceRecording).toHaveBeenCalledTimes(1);
  });

  it("uses the trailing Figma action for sending when text is present", () => {
    const onSend = jest.fn();
    const onStartVoiceRecording = jest.fn();
    const screen = render(
      <Composer
        attachment={null}
        draftText="Вітаю"
        isSending={false}
        onAttach={jest.fn()}
        onChangeDraftText={jest.fn()}
        onClearAttachment={jest.fn()}
        onOpenMenu={jest.fn()}
        onSend={onSend}
        onStartVoiceRecording={onStartVoiceRecording}
        onStopVoiceRecording={jest.fn()}
      />,
    );

    act(() => {
      screen.renderer.root
        .findByProps({ accessibilityLabel: "Send message" })
        .props.onPress();
    });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onStartVoiceRecording).not.toHaveBeenCalled();
  });
});
