import React from "react";
import { Animated } from "react-native";

import { render } from "@/test/render";

import { MobileStatusPill } from "./MobileStatusPill";

describe("MobileStatusPill", () => {
  it("renders a label with a status dot", () => {
    const screen = render(<MobileStatusPill label="Connected" />);

    expect(screen.getTextContent()).toContain("Connected");
    expect(
      screen.renderer.root.findByProps({ testID: "mobile-status-dot" }),
    ).toBeTruthy();
  });

  it("renders the animated dot with Animated.View", () => {
    const screen = render(
      <MobileStatusPill
        animatedDotStyle={{ transform: [{ scale: new Animated.Value(1) }] }}
        label="Thinking"
      />,
    );

    const dot = screen.renderer.root.findByProps({
      testID: "mobile-status-dot",
    });

    expect(dot.type).toBe(Animated.View);
  });
});
