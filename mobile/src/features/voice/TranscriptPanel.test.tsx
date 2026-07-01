import React from "react";
import { ScrollView, StyleSheet } from "react-native";

import { render } from "@/test/render";
import { webTheme } from "@/theme/webTheme";

import { TranscriptPanel } from "./TranscriptPanel";

describe("TranscriptPanel", () => {
  it("shows only user and assistant messages without section or role labels", () => {
    const screen = render(
      <TranscriptPanel
        transcript={[
          { id: "system-1", role: "system", text: "processing" },
          { id: "user-1", role: "user", text: "Прывітанне" },
          { id: "assistant-1", role: "assistant", text: "Вітаю" },
        ]}
      />,
    );

    const text = screen.getTextContent();

    expect(text).toContain("Прывітанне");
    expect(text).toContain("Вітаю");
    expect(text).not.toContain("processing");
    expect(text).not.toContain("Дыялог");
    expect(text).not.toContain("Вучань");
    expect(text).not.toContain("Настаўнік");
    expect(text).not.toContain("Сістэма");
  });

  it("registers content-size scrolling so the latest turn remains visible", () => {
    const screen = render(
      <TranscriptPanel
        transcript={[
          { id: "user-1", role: "user", text: "Першае" },
          { id: "assistant-1", role: "assistant", text: "Апошняе" },
        ]}
      />,
    );

    const scrollView = screen.renderer.root.findByType(ScrollView);

    expect(scrollView.props.onContentSizeChange).toEqual(expect.any(Function));
  });

  it("renders the compact empty state as a visible transcript input", () => {
    const screen = render(<TranscriptPanel compact transcript={[]} />);

    const panelStyle = StyleSheet.flatten(
      screen.renderer.root.findByProps({ testID: "transcript-panel" }).props
        .style,
    );
    const emptyStyle = StyleSheet.flatten(
      screen.renderer.root.findByProps({ testID: "transcript-empty" }).props
        .style,
    );

    expect(panelStyle.minHeight).toBe(52);
    expect(panelStyle.borderWidth).toBe(1);
    expect(panelStyle.backgroundColor).toBe(webTheme.colors.surface);
    expect(emptyStyle.borderWidth).toBe(0);
    expect(emptyStyle.padding).toBe(0);
  });

  it("uses a listening prompt when the microphone is active but no transcript exists yet", () => {
    const screen = render(
      <TranscriptPanel
        compact
        emptyText="Гаварыце..."
        transcript={[]}
      />,
    );

    expect(screen.getTextContent()).toContain("Гаварыце...");
    expect(screen.getTextContent()).not.toContain("Размова яшчэ не пачалася");
  });
});
