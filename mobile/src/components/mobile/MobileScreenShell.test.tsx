import React from "react";
import { Text } from "react-native";
import { act } from "react-test-renderer";

import { render } from "@/test/render";

import { MobileScreenShell } from "./MobileScreenShell";

describe("MobileScreenShell", () => {
  it("renders children inside the shared mobile surface", () => {
    const screen = render(
      <MobileScreenShell>
        <Text>Content</Text>
      </MobileScreenShell>,
    );

    expect(screen.getTextContent()).toContain("Content");
    expect(
      screen.renderer.root.findByProps({ testID: "mobile-screen-shell" }),
    ).toBeTruthy();
  });

  it("renders the shared Figma header with a menu trigger and screen title", () => {
    const onOpenMenu = jest.fn();
    const screen = render(
      <MobileScreenShell onOpenMenu={onOpenMenu} title="Размова">
        <Text>Content</Text>
      </MobileScreenShell>,
    );

    const header = screen.renderer.root.findByProps({
      testID: "mobile-screen-header",
    });
    const menuButton = screen.renderer.root.findByProps({
      accessibilityLabel: "Open Размова menu",
    });

    act(() => {
      menuButton.props.onPress();
    });

    expect(header).toBeTruthy();
    expect(screen.getTextContent()).toContain("Размова");
    expect(onOpenMenu).toHaveBeenCalledTimes(1);
  });
});
