import { KeyboardAvoidingView, StyleSheet, Text, View } from "react-native";
import { act } from "react-test-renderer";

import { createVoiceRecorderAdapter } from "@/lib/audio-recording";
import { render } from "@/test/render";
import { webTheme } from "@/theme/webTheme";

import { createVoiceAttachmentFromWavBytes } from "./chat-voice-attachment";
import ChatScreen, { ChatHeader } from "./ChatScreen";

const mockOpenMenu = jest.fn();
const mockClearHistory = jest.fn().mockResolvedValue(undefined);
const mockSetAttachment = jest.fn();
const mockSendMessage = jest.fn();

jest.mock("@/lib/api", () => ({
  createChatApiClient: jest.fn(() => ({
    clearHistory: jest.fn(),
    getHistory: jest.fn(),
    sendMessage: jest.fn(),
  })),
}));

jest.mock("@/lib/env", () => ({
  getRuntimeEnv: () => ({ backendUrl: "http://localhost:8000" }),
}));

jest.mock("@/lib/file-picker", () => ({
  pickSingleAttachment: jest.fn(),
}));

jest.mock("@/lib/legacy-user-id", () => ({
  getLegacyMobileUserId: jest.fn(),
}));

jest.mock("@/lib/supabase", () => ({
  getSupabaseSession: jest.fn(),
}));

jest.mock("@/lib/audio-recording", () => ({
  createVoiceRecorderAdapter: jest.fn(),
}));

jest.mock("./chat-voice-attachment", () => ({
  createVoiceAttachmentFromWavBytes: jest.fn(),
}));

jest.mock("expo-audio", () => ({
  useAudioPlayer: jest.fn(() => ({
    pause: jest.fn(),
    play: jest.fn(),
  })),
  useAudioPlayerStatus: jest.fn(() => ({
    duration: 0,
    playing: false,
  })),
}));

jest.mock("@/navigation/MenuContext", () => ({
  useMenu: () => ({ openMenu: mockOpenMenu }),
}));

jest.mock("react-native-safe-area-context", () => {
  const { View } = jest.requireActual("react-native");
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
  };
});

jest.mock("./useChatController", () => ({
  useChatController: () => ({
    attachment: null,
    clearAttachment: jest.fn(),
    clearHistory: mockClearHistory,
    draftText: "",
    error: null,
    isSending: false,
    messages: [],
    pickAttachment: jest.fn(),
    sendMessage: mockSendMessage,
    setAttachment: mockSetAttachment,
    setDraftText: jest.fn(),
  }),
}));

describe("ChatHeader", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClearHistory.mockResolvedValue(undefined);
    mockSendMessage.mockResolvedValue(undefined);
    jest.mocked(createVoiceRecorderAdapter).mockReturnValue({
      prepare: jest.fn().mockResolvedValue(undefined),
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue({
        uri: null,
        wavBytes: new Uint8Array([0x52, 0x49, 0x46, 0x46]),
      }),
    });
    jest.mocked(createVoiceAttachmentFromWavBytes).mockResolvedValue({
      uri: "file:///cache/voice-message.wav",
      name: "voice-message.wav",
      mimeType: "audio/wav",
    });
  });

  it("matches the Figma header menu label and trash affordances", () => {
    const onOpenMenu = jest.fn();
    const onClearHistory = jest.fn();

    const screen = render(
      <ChatHeader onClearHistory={onClearHistory} onOpenMenu={onOpenMenu} />,
    );

    const menuButton = screen.renderer.root
      .findAllByProps({ accessibilityLabel: "Open chat menu" })
      .find((node) => typeof node.props.onPress === "function");
    const menuIcon = screen.renderer.root.findByProps({
      testID: "mobile-screen-header-menu-icon",
    });
    const menuLines = menuIcon
      .findAllByType(View)
      .filter((node) => StyleSheet.flatten(node.props.style).backgroundColor);
    const title = screen.renderer.root.findByProps({
      testID: "mobile-screen-header-title",
    });
    const trashIcon = screen.renderer.root.findByProps({
      testID: "chat-header-trash-icon",
    });
    const trashLines = trashIcon
      .findAllByType(View)
      .filter((node) => StyleSheet.flatten(node.props.style).backgroundColor);

    act(() => {
      menuButton?.props.onPress();
      screen.renderer.root
        .findByProps({ accessibilityLabel: "Clear chat history" })
        .props.onPress();
    });

    expect(onOpenMenu).toHaveBeenCalledTimes(1);
    expect(onClearHistory).toHaveBeenCalledTimes(1);
    expect(screen.getTextContent()).toContain("Чат");

    expect(StyleSheet.flatten(menuIcon.props.style).borderWidth ?? 0).toBe(0);
    expect(StyleSheet.flatten(menuLines[0].props.style).backgroundColor).toBe(
      webTheme.colors.primary,
    );
    expect(StyleSheet.flatten(title.props.style).color).toBe(webTheme.colors.text);
    expect(
      screen.renderer.root
        .findAllByType(Text)
        .some((node) => node.props.children === "x"),
    ).toBe(false);
    expect(trashLines.length).toBeGreaterThanOrEqual(4);
  });

  it("keeps header icon actions large enough for mobile touch targets", () => {
    const screen = render(
      <ChatHeader onClearHistory={jest.fn()} onOpenMenu={jest.fn()} />,
    );

    const clearButton = screen.renderer.root.findByProps({
      accessibilityLabel: "Clear chat history",
    });
    const clearButtonStyle = StyleSheet.flatten(clearButton.props.style);

    expect(clearButtonStyle.width).toBeGreaterThanOrEqual(44);
    expect(clearButtonStyle.height).toBeGreaterThanOrEqual(44);
  });

  it("shows a mobile-sized clear history confirmation state", () => {
    const screen = render(<ChatScreen />);

    act(() => {
      screen.renderer.root
        .findByProps({ accessibilityLabel: "Clear chat history" })
        .props.onPress();
    });

    const overlay = screen.renderer.root.findByProps({
      testID: "chat-clear-confirm-overlay",
    });
    const dialog = screen.renderer.root.findByProps({
      testID: "chat-clear-confirm-dialog",
    });
    const deleteButton = screen.renderer.root.findByProps({
      accessibilityLabel: "Confirm clear chat history",
    });
    const cancelButton = screen.renderer.root.findByProps({
      accessibilityLabel: "Cancel clear chat history",
    });

    const overlayStyle = StyleSheet.flatten(overlay.props.style);
    const dialogStyle = StyleSheet.flatten(dialog.props.style);
    const deleteStyle = StyleSheet.flatten(deleteButton.props.style);
    const cancelStyle = StyleSheet.flatten(cancelButton.props.style);

    expect(overlayStyle.paddingHorizontal).toBeLessThanOrEqual(24);
    expect(dialogStyle.maxWidth).toBeGreaterThanOrEqual(280);
    expect(dialogStyle.borderRadius).toBeLessThanOrEqual(webTheme.radii.md);
    expect(deleteStyle.minHeight).toBeGreaterThanOrEqual(44);
    expect(cancelStyle.minHeight).toBeGreaterThanOrEqual(44);

    act(() => {
      screen.renderer.unmount();
    });
  });

  it("constrains the chat surface to mobile width on wide web screens", () => {
    const screen = render(<ChatScreen />);
    const frame = screen.renderer.root.findByType(KeyboardAvoidingView);
    const frameStyle = StyleSheet.flatten(frame.props.style);

    expect(frameStyle.width).toBe("100%");
    expect(frameStyle.maxWidth).toBeLessThanOrEqual(430);
    expect(frameStyle.alignSelf).toBe("center");

    act(() => {
      screen.renderer.unmount();
    });
  });

  it("creates a voice attachment on microphone release without sending it", async () => {
    const screen = render(<ChatScreen />);
    const voiceButton = screen.renderer.root.findByProps({
      accessibilityLabel: "Start voice message",
    });

    await act(async () => {
      voiceButton.props.onPressIn();
    });

    expect(
      screen.renderer.root.findByProps({ testID: "voice-recording-wave" }),
    ).toBeTruthy();

    const releaseButton = screen.renderer.root.findByProps({
      accessibilityLabel: "Start voice message",
    });

    await act(async () => {
      releaseButton.props.onPressOut();
    });

    expect(createVoiceAttachmentFromWavBytes).toHaveBeenCalledWith({
      wavBytes: new Uint8Array([0x52, 0x49, 0x46, 0x46]),
    });
    expect(mockSetAttachment).toHaveBeenCalledWith({
      uri: "file:///cache/voice-message.wav",
      name: "voice-message.wav",
      mimeType: "audio/wav",
    });
    expect(mockSendMessage).not.toHaveBeenCalled();

    act(() => {
      screen.renderer.unmount();
    });
  });
});
