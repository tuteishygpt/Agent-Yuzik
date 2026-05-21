import React from "react";
import { act } from "react-test-renderer";

import { render } from "@/test/render";

import { VoiceControls } from "./VoiceControls";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 24, left: 0, right: 0, top: 0 }),
}));

describe("VoiceControls", () => {
  it("renders a bottom menu button beside the start button", () => {
    const onOpenMenu = jest.fn();

    const screen = render(
      <VoiceControls
        status="connected"
        isListening={false}
        onOpenMenu={onOpenMenu}
        onStartListening={jest.fn()}
        onStopListening={jest.fn()}
        onInterrupt={jest.fn()}
      />,
    );

    expect(screen.getTextContent()).toContain("☰");
    expect(screen.getTextContent()).toContain("Пачаць");
  });

  it("opens the menu from the bottom controls", () => {
    const onOpenMenu = jest.fn();

    const screen = render(
      <VoiceControls
        status="connected"
        isListening={false}
        onOpenMenu={onOpenMenu}
        onStartListening={jest.fn()}
        onStopListening={jest.fn()}
        onInterrupt={jest.fn()}
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
});
