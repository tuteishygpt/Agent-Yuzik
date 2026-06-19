import React from "react";
import { Text } from "react-native";

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
});
