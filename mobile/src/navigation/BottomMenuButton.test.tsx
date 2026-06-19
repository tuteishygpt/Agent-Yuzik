import React from "react";
import { act } from "react-test-renderer";

import { render } from "@/test/render";

import { BottomMenuButton } from "./BottomMenuButton";

describe("BottomMenuButton", () => {
  it("renders the shared bottom menu control and opens the menu", () => {
    const onPress = jest.fn();

    const screen = render(<BottomMenuButton onPress={onPress} />);

    const button = screen.renderer.root.findByProps({
      accessibilityLabel: "Open menu",
    });

    act(() => {
      button.props.onPress();
    });

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
