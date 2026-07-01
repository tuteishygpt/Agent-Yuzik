import React from "react";
import { StyleSheet, View } from "react-native";
import { act } from "react-test-renderer";

import { render } from "@/test/render";
import { webTheme } from "@/theme/webTheme";

import { MobileMenu } from "./MobileMenu";

describe("MobileMenu", () => {
  const items = [
    { label: "Voice", route: "voice", description: "Talk live" },
    { label: "Chat", route: "chat" },
  ];

  it("renders route labels and calls selection callbacks", () => {
    const onSelect = jest.fn();

    const screen = render(
      <MobileMenu activeRoute="voice" items={items} onSelect={onSelect} />,
    );

    expect(screen.getTextContent()).toContain("Voice");
    expect(screen.getTextContent()).toContain("Chat");
    expect(screen.getTextContent()).not.toContain("Talk live");

    const chatButton = screen.renderer.root.findByProps({
      accessibilityLabel: "Open Chat",
    });
    act(() => {
      chatButton.props.onPress();
    });

    expect(onSelect).toHaveBeenCalledWith("chat");
  });

  it("uses the shared Figma menu dimensions instead of a bottom-sheet menu", () => {
    const screen = render(
      <MobileMenu activeRoute="voice" items={items} onSelect={jest.fn()} />,
    );

    const menu = screen.renderer.root.findByProps({
      testID: "mobile-menu",
    });
    const menuStyle = StyleSheet.flatten(menu.props.style);
    const firstRow = screen.renderer.root.findByProps({
      accessibilityLabel: "Open Voice",
    });
    const firstRowStyle = StyleSheet.flatten(
      firstRow.props.style({ pressed: false }),
    );
    const headers = screen.renderer.root.findAllByProps({
      testID: "mobile-menu-header",
    });
    const activeIndicators = screen.renderer.root.findAllByType(View).filter(
      (node) => node.props.testID === "mobile-menu-active-indicator",
    );

    expect(menuStyle.width).toBe(webTheme.sizes.menuWidth);
    expect(menuStyle.padding).toBe(webTheme.spacing.lg);
    expect(menuStyle.borderRadius).toBe(webTheme.radii.basic);
    expect(firstRowStyle.height).toBe(webTheme.sizes.menuRowHeight);
    expect(firstRowStyle.borderRadius).toBe(webTheme.radii.sm);
    expect(headers).toHaveLength(0);
    expect(activeIndicators).toHaveLength(0);
  });
});
