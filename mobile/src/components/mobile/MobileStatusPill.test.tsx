import React from "react";

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
});
