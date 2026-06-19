import React from "react";
import { act } from "react-test-renderer";

import { render } from "@/test/render";

import { MobileMenu } from "./MobileMenu";

describe("MobileMenu", () => {
  const items = [
    { label: "Voice", route: "voice" },
    { label: "Chat", route: "chat" },
  ];

  it("renders route labels and calls selection callbacks", () => {
    const onSelect = jest.fn();

    const screen = render(
      <MobileMenu activeRoute="voice" items={items} onSelect={onSelect} />,
    );

    expect(screen.getTextContent()).toContain("Voice");
    expect(screen.getTextContent()).toContain("Chat");

    const chatButton = screen.renderer.root.findByProps({
      accessibilityLabel: "Open Chat",
    });
    act(() => {
      chatButton.props.onPress();
    });

    expect(onSelect).toHaveBeenCalledWith("chat");
  });
});
