import React from "react";
import { act } from "react-test-renderer";

import { render } from "@/test/render";

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

  it("stops listening before interrupting when active", () => {
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

    const stopButton = screen.renderer.root.findByProps({
      accessibilityLabel: "Stop listening",
    });

    act(() => {
      stopButton.props.onPress();
    });

    expect(calls).toEqual(["stop", "interrupt"]);
  });
});
