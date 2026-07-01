import React from "react";
import { StyleSheet, View } from "react-native";
import { act } from "react-test-renderer";

import { render } from "@/test/render";

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

    expect(inputContainerStyle.minHeight).toBe(52);
    expect(inputContainerStyle.borderRadius).toBe(26);
    expect(inputContainerStyle.borderColor).toBe("#ed6760");
    expect(screen.getTextContent()).not.toContain("Yuzik can make mistakes.");
  });

  it("starts voice recording from the trailing Figma action when the draft is empty", () => {
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
      voiceButton.props.onPress();
    });

    expect(onStartVoiceRecording).toHaveBeenCalledTimes(1);
    expect(onStopVoiceRecording).not.toHaveBeenCalled();
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

  it("shows the Figma recording controls and confirms or cancels the voice draft", () => {
    const onConfirmVoiceRecording = jest.fn();
    const onCancelVoiceRecording = jest.fn();
    const screen = render(
      <Composer
        attachment={null}
        draftText=""
        isRecordingVoice
        isSending={false}
        onAttach={jest.fn()}
        onCancelVoiceRecording={onCancelVoiceRecording}
        onChangeDraftText={jest.fn()}
        onClearAttachment={jest.fn()}
        onConfirmVoiceRecording={onConfirmVoiceRecording}
        onOpenMenu={jest.fn()}
        onSend={jest.fn()}
        onStartVoiceRecording={jest.fn()}
        onStopVoiceRecording={jest.fn()}
      />,
    );

    expect(
      screen.renderer.root.findByProps({ testID: "voice-recording-wave" }),
    ).toBeTruthy();

    act(() => {
      screen.renderer.root
        .findByProps({ accessibilityLabel: "Send voice message" })
        .props.onPress();
      screen.renderer.root
        .findByProps({ accessibilityLabel: "Cancel voice message" })
        .props.onPress();
    });

    expect(onConfirmVoiceRecording).toHaveBeenCalledTimes(1);
    expect(onCancelVoiceRecording).toHaveBeenCalledTimes(1);
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
