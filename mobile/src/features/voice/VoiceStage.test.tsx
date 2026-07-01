import React from "react";
import { Animated } from "react-native";
import { act } from "react-test-renderer";

import { render } from "@/test/render";

import { VoiceStage } from "./VoiceStage";
import type { VoiceUiState } from "./voice-ui-state";

const connectedUiState: VoiceUiState = {
  phase: "connected",
  connectionLabel: "Connected",
  statusLabel: "Tap to start",
  accentColor: "#26805b",
  haloColor: "rgba(38, 128, 91, 0.18)",
  icon: "mic",
  shouldAnimateMic: false,
  shouldAnimateHalo: false,
  shouldAnimateVisualizer: false,
  shouldPulseConnection: false,
};

const listeningUiState: VoiceUiState = {
  ...connectedUiState,
  phase: "listening",
  statusLabel: "Слухаю...",
  shouldAnimateHalo: true,
};

describe("VoiceStage", () => {
  it("starts listening when idle stage is pressed", () => {
    const onStart = jest.fn();
    const screen = render(
      <VoiceStage
        animatedStyles={{}}
        title="Voice"
        transcript={[]}
        uiState={connectedUiState}
        visualizerPulse={new Animated.Value(0)}
        onPrimaryPress={onStart}
      />,
    );

    act(() => {
      screen.renderer.root
        .findByProps({ testID: "voice-stage-pressable" })
        .props.onPress();
    });

    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("renders the Yuzik avatar and transcript panel", () => {
    const screen = render(
      <VoiceStage
        animatedStyles={{}}
        title="Voice"
        transcript={[{ id: "user-1", role: "user", text: "Hello" }]}
        uiState={connectedUiState}
        visualizerPulse={new Animated.Value(0)}
        onPrimaryPress={jest.fn()}
      />,
    );

    expect(
      screen.renderer.root.findByProps({ testID: "yuzik-avatar" }),
    ).toBeTruthy();
    expect(screen.getTextContent()).toContain("Hello");
  });

  it("can render the compact Figma stage without a duplicate body title", () => {
    const screen = render(
      <VoiceStage
        animatedStyles={{}}
        compact
        transcript={[]}
        uiState={connectedUiState}
        visualizerPulse={new Animated.Value(0)}
        onPrimaryPress={jest.fn()}
      />,
    );

    expect(screen.getTextContent()).not.toContain("Voice");
    expect(
      screen.renderer.root.findByProps({ testID: "yuzik-avatar" }).props.style,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          width: 130,
          height: 130,
          borderRadius: 65,
        }),
      ]),
    );
  });

  it("shows a listening transcript prompt instead of the not-started empty state", () => {
    const screen = render(
      <VoiceStage
        animatedStyles={{}}
        compact
        transcript={[]}
        uiState={listeningUiState}
        visualizerPulse={new Animated.Value(0)}
        onPrimaryPress={jest.fn()}
      />,
    );

    expect(screen.getTextContent()).toContain("Гаварыце...");
    expect(screen.getTextContent()).not.toContain("Размова яшчэ не пачалася");
  });
});
