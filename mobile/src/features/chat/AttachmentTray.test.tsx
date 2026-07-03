import { StyleSheet } from "react-native";

import { render } from "@/test/render";

import { AttachmentTray } from "./AttachmentTray";

describe("AttachmentTray", () => {
  it("keeps the remove action usable as a mobile touch target", () => {
    const screen = render(
      <AttachmentTray
        attachment={{
          uri: "file:///cache/image.png",
          mimeType: "image/png",
          name: "image.png",
        }}
        onClear={jest.fn()}
      />,
    );

    const clearButton = screen.renderer.root.findByProps({
      accessibilityLabel: "Remove attachment",
    });
    const clearButtonStyle = StyleSheet.flatten(clearButton.props.style);

    expect(clearButtonStyle.minHeight).toBeGreaterThanOrEqual(44);
    expect(clearButtonStyle.minWidth).toBeGreaterThanOrEqual(44);
  });
});
