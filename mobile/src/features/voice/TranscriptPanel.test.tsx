import React from "react";
import { ScrollView } from "react-native";

import { render } from "@/test/render";

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
});
