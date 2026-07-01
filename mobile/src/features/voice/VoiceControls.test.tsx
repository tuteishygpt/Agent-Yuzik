import React from "react";
import { StyleSheet } from "react-native";
import { act } from "react-test-renderer";

import { render } from "@/test/render";
import { webTheme } from "@/theme/webTheme";

import { VoiceControls } from "./VoiceControls";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 24, left: 0, right: 0, top: 0 }),
}));

describe("VoiceControls", () => {
  it("renders a bottom menu button beside the start button", () => {
    const screen = render(
      <VoiceControls
        isListening={false}
        onInterrupt={jest.fn()}
        onOpenMenu={jest.fn()}
        onStartListening={jest.fn()}
        onStopListening={jest.fn()}
        status="connected"
      />,
    );

    expect(
      screen.renderer.root.findByProps({ accessibilityLabel: "Open menu" }),
    ).toBeTruthy();
    expect(
      screen.renderer.root.findByProps({ accessibilityLabel: "Start listening" }),
    ).toBeTruthy();
  });

  it("opens the menu from the bottom controls", () => {
    const onOpenMenu = jest.fn();

    const screen = render(
      <VoiceControls
        isListening={false}
        onInterrupt={jest.fn()}
        onOpenMenu={onOpenMenu}
        onStartListening={jest.fn()}
        onStopListening={jest.fn()}
        status="connected"
      />,
    );

    const menuButton = screen.renderer.root.findByProps({
      accessibilityLabel: "Open menu",
    });

    act(() => {
      menuButton.props.onPress();
    });

    expect(onOpenMenu).toHaveBeenCalledTimes(1);
  });

  it("shows the Figma listening input controls when active", () => {
    const screen = render(
      <VoiceControls
        isListening
        onInterrupt={jest.fn()}
        onStartListening={jest.fn()}
        onStopListening={jest.fn()}
        status="connected"
      />,
    );

    expect(
      screen.renderer.root.findByProps({ testID: "voice-listening-input" }),
    ).toBeTruthy();
    expect(
      screen.renderer.root.findByProps({ accessibilityLabel: "Confirm transcript" }),
    ).toBeTruthy();
    expect(
      screen.renderer.root.findByProps({ accessibilityLabel: "Discard transcript" }),
    ).toBeTruthy();
  });

  it("discards the active transcript by stopping before interrupting", () => {
    const calls: string[] = [];

    const screen = render(
      <VoiceControls
        isListening
        onInterrupt={() => {
          calls.push("interrupt");
        }}
        onStartListening={jest.fn()}
        onStopListening={() => {
          calls.push("stop");
        }}
        status="connected"
      />,
    );

    const discardButton = screen.renderer.root.findByProps({
      accessibilityLabel: "Discard transcript",
    });

    act(() => {
      discardButton.props.onPress();
    });

    expect(calls).toEqual(["stop", "interrupt"]);
  });

  it("uses the shared Figma CTA sizing for the voice action", () => {
    const screen = render(
      <VoiceControls
        isListening={false}
        onInterrupt={jest.fn()}
        onOpenMenu={jest.fn()}
        onStartListening={jest.fn()}
        onStopListening={jest.fn()}
        status="connected"
      />,
    );

    const startButton = screen.renderer.root.findByProps({
      accessibilityLabel: "Start listening",
    });
    const buttonStyle = StyleSheet.flatten(startButton.props.style);

    expect(buttonStyle.height).toBe(webTheme.sizes.ctaHeight);
    expect(buttonStyle.borderRadius).toBe(webTheme.radii.cta);
    expect(buttonStyle.backgroundColor).toBe(webTheme.colors.primary);
  });

  it("lets the start button retry after a connection error", () => {
    const onStartListening = jest.fn();
    const screen = render(
      <VoiceControls
        isListening={false}
        onInterrupt={jest.fn()}
        onOpenMenu={jest.fn()}
        onStartListening={onStartListening}
        onStopListening={jest.fn()}
        status="error"
      />,
    );

    const startButton = screen.renderer.root.findByProps({
      accessibilityLabel: "Start listening",
    });

    expect(startButton.props.disabled).toBe(false);

    act(() => {
      startButton.props.onPress();
    });

    expect(onStartListening).toHaveBeenCalledTimes(1);
  });
});
