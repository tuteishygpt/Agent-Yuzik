import React from "react";
import { Image, StyleSheet } from "react-native";

import { render } from "@/test/render";

import { YuzikAvatar } from "./YuzikAvatar";

describe("YuzikAvatar", () => {
  it("renders an accessible Yuzik avatar image instead of a text mark", () => {
    const screen = render(<YuzikAvatar state="listening" />);

    expect(
      screen.renderer.root.findByProps({ testID: "yuzik-avatar" }).props
        .accessibilityLabel,
    ).toContain("Yuzik");
    expect(screen.renderer.root.findByType(Image)).toBeTruthy();
    expect(screen.getTextContent()).not.toContain("Y");
  });

  it("matches the Figma default avatar size on the start screen", () => {
    const screen = render(<YuzikAvatar size="figma" />);
    const avatar = screen.renderer.root.findByProps({ testID: "yuzik-avatar" });
    const style = StyleSheet.flatten(avatar.props.style);

    expect(style.width).toBe(130);
    expect(style.height).toBe(130);
  });
});
