import { StyleSheet, Text, View } from "react-native";
import { act } from "react-test-renderer";

import { render } from "@/test/render";
import { webTheme } from "@/theme/webTheme";

import { ChatHeader } from "./ChatScreen";

describe("ChatHeader", () => {
  it("matches the Figma header menu label and trash affordances", () => {
    const onOpenMenu = jest.fn();
    const onClearHistory = jest.fn();

    const screen = render(
      <ChatHeader onClearHistory={onClearHistory} onOpenMenu={onOpenMenu} />,
    );

    const menuButton = screen.renderer.root
      .findAllByProps({ accessibilityLabel: "Open chat menu" })
      .find((node) => typeof node.props.onPress === "function");
    const menuIcon = screen.renderer.root.findByProps({
      testID: "mobile-screen-header-menu-icon",
    });
    const menuLines = menuIcon
      .findAllByType(View)
      .filter((node) => StyleSheet.flatten(node.props.style).backgroundColor);
    const title = screen.renderer.root.findByProps({
      testID: "mobile-screen-header-title",
    });
    const trashIcon = screen.renderer.root.findByProps({
      testID: "chat-header-trash-icon",
    });
    const trashLines = trashIcon
      .findAllByType(View)
      .filter((node) => StyleSheet.flatten(node.props.style).backgroundColor);

    act(() => {
      menuButton?.props.onPress();
      screen.renderer.root
        .findByProps({ accessibilityLabel: "Clear chat history" })
        .props.onPress();
    });

    expect(onOpenMenu).toHaveBeenCalledTimes(1);
    expect(onClearHistory).toHaveBeenCalledTimes(1);
    expect(screen.getTextContent()).toContain("Чат");

    expect(StyleSheet.flatten(menuIcon.props.style).borderWidth ?? 0).toBe(0);
    expect(StyleSheet.flatten(menuLines[0].props.style).backgroundColor).toBe(
      webTheme.colors.primary,
    );
    expect(StyleSheet.flatten(title.props.style).color).toBe(webTheme.colors.text);
    expect(
      screen.renderer.root
        .findAllByType(Text)
        .some((node) => node.props.children === "x"),
    ).toBe(false);
    expect(trashLines.length).toBeGreaterThanOrEqual(4);
  });
});
