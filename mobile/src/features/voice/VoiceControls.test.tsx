import React from "react";
import { Animated, StyleSheet } from "react-native";
import { act } from "react-test-renderer";

import { render } from "@/test/render";
import { webTheme } from "@/theme/webTheme";

import { VoiceControls } from "./VoiceControls";
import type { VoiceUiState } from "./voice-ui-state";

const listeningUiState: VoiceUiState = {
  phase: "listening",
  connectionLabel: "Listening",
  statusLabel: "Listening",
  accentColor: "#d85a5c",
  haloColor: "rgba(216, 90, 92, 0.18)",
  icon: "mic",
  shouldAnimateMic: true,
  shouldAnimateHalo: true,
  shouldAnimateVisualizer: true,
  shouldPulseConnection: false,
};

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
      screen.renderer.root.findByProps({
        accessibilityLabel: "Start listening",
      }),
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
      screen.renderer.root.findByProps({
        accessibilityLabel: "Confirm transcript",
      }),
    ).toBeTruthy();
    expect(
      screen.renderer.root.findByProps({
        accessibilityLabel: "Discard transcript",
      }),
    ).toBeTruthy();
  });

  it("animates waveform bars inside the listening input", () => {
    const pulse = new Animated.Value(0);
    const screen = render(
      <VoiceControls
        isListening
        onInterrupt={jest.fn()}
        onStartListening={jest.fn()}
        onStopListening={jest.fn()}
        status="connected"
        uiState={listeningUiState}
        visualizerPulse={pulse}
      />,
    );

    const bars = screen.renderer.root.findAllByProps({
      testID: "voice-listening-waveform-bar",
    });

    expect(bars.length).toBeGreaterThan(12);
    expect(StyleSheet.flatten(bars[0].props.style).backgroundColor).toBe(
      listeningUiState.accentColor,
    );
  });

  it("scales waveform bars with the live microphone input level", () => {
    const renderWithLevel = (inputLevel: number) =>
      render(
        <VoiceControls
          inputLevel={inputLevel}
          isListening
          onInterrupt={jest.fn()}
          onStartListening={jest.fn()}
          onStopListening={jest.fn()}
          status="connected"
          uiState={listeningUiState}
        />,
      );

    const quietBars = renderWithLevel(0.1).renderer.root.findAllByProps({
      testID: "voice-listening-waveform-bar",
    });
    const loudBars = renderWithLevel(0.9).renderer.root.findAllByProps({
      testID: "voice-listening-waveform-bar",
    });

    const quietHeight = StyleSheet.flatten(quietBars[5].props.style).height;
    const loudHeight = StyleSheet.flatten(loudBars[5].props.style).height;

    expect(typeof quietHeight).toBe("number");
    expect(typeof loudHeight).toBe("number");
    expect(loudHeight).toBeGreaterThan(quietHeight);
  });

  it("stretches waveform bars across the listening input width", () => {
    const screen = render(
      <VoiceControls
        inputLevel={0.5}
        isListening
        onInterrupt={jest.fn()}
        onStartListening={jest.fn()}
        onStopListening={jest.fn()}
        status="connected"
        uiState={listeningUiState}
      />,
    );

    const inputStyle = StyleSheet.flatten(
      screen.renderer.root.findByProps({ testID: "voice-listening-input" })
        .props.style,
    );
    const firstBarStyle = StyleSheet.flatten(
      screen.renderer.root.findAllByProps({
        testID: "voice-listening-waveform-bar",
      })[0].props.style,
    );

    expect(inputStyle.justifyContent).toBe("space-between");
    expect(firstBarStyle.flex).toBe(1);
    expect(firstBarStyle.width).toBeUndefined();
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
