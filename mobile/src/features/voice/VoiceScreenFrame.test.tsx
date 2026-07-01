import React from "react";
import { Text } from "react-native";

import { render } from "@/test/render";

import { VoiceScreenFrame } from "./VoiceScreenFrame";

describe("VoiceScreenFrame", () => {
  it("keeps voice and teacher screens on the shared mobile frame", () => {
    const screen = render(
      <VoiceScreenFrame bottomControls={<Text>Controls</Text>}>
        <Text>Stage</Text>
      </VoiceScreenFrame>,
    );

    expect(
      screen.renderer.root.findByProps({ testID: "mobile-screen-shell" }),
    ).toBeTruthy();
    expect(screen.getTextContent()).toContain("Stage");
    expect(screen.getTextContent()).toContain("Controls");
  });
});
