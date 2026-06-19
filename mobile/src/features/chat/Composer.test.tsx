import React from "react";
import { StyleSheet, View } from "react-native";
import { act } from "react-test-renderer";

import { render } from "@/test/render";

import { Composer } from "./Composer";

jest.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        "chat.placeholder": "Write a message...",
        "chat.footer": "Yuzik can make mistakes.",
      })[key] ?? key,
  }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 24, left: 0, right: 0, top: 0 }),
}));

describe("Composer", () => {
  it("renders the shared bottom menu button beside the chat composer", () => {
    const onOpenMenu = jest.fn();

    const screen = render(
      <Composer
        attachment={null}
        draftText=""
        isSending={false}
        onAttach={jest.fn()}
        onChangeDraftText={jest.fn()}
        onClearAttachment={jest.fn()}
        onOpenMenu={onOpenMenu}
        onSend={jest.fn()}
      />,
    );

    const button = screen.renderer.root.findByProps({
      accessibilityLabel: "Open menu",
    });

    act(() => {
      button.props.onPress();
    });

    expect(onOpenMenu).toHaveBeenCalledTimes(1);
  });

  it("keeps bottom controls above Android navigation with stable alignment", () => {
    const screen = render(
      <Composer
        attachment={null}
        draftText=""
        isSending={false}
        onAttach={jest.fn()}
        onChangeDraftText={jest.fn()}
        onClearAttachment={jest.fn()}
        onOpenMenu={jest.fn()}
        onSend={jest.fn()}
      />,
    );

    const views = screen.renderer.root.findAllByType(View);
    const containerStyle = StyleSheet.flatten(views[0].props.style);
    const inputShell = screen.renderer.root.findByProps({
      testID: "chat-composer-input-shell",
    });
    const inputContainerStyle = StyleSheet.flatten(inputShell.props.style);

    expect(containerStyle.paddingBottom).toBe(32);
    expect(inputContainerStyle.minHeight).toBeGreaterThanOrEqual(52);
    expect(inputContainerStyle.flexShrink).toBe(1);
  });
});
