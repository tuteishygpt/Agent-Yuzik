import React from "react";

import { render } from "@/test/render";

import { YuzikAvatar } from "./YuzikAvatar";

describe("YuzikAvatar", () => {
  it("renders an accessible Yuzik mark", () => {
    const screen = render(<YuzikAvatar state="listening" />);

    expect(
      screen.renderer.root.findByProps({ testID: "yuzik-avatar" }).props
        .accessibilityLabel,
    ).toContain("Yuzik");
    expect(screen.getTextContent()).toContain("Y");
  });
});
