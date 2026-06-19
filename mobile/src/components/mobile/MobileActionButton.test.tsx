import React from "react";
import { act } from "react-test-renderer";

import { render } from "@/test/render";

import { MobileActionButton } from "./MobileActionButton";

describe("MobileActionButton", () => {
  it("calls onPress from the shared action control", () => {
    const onPress = jest.fn();

    const screen = render(
      <MobileActionButton label="Send" onPress={onPress} />,
    );
    const button = screen.renderer.root.findByProps({
      accessibilityLabel: "Send",
    });

    act(() => {
      button.props.onPress();
    });

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
