import type { ReactElement } from "react";
import { Text } from "react-native";
import TestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";

function flattenText(value: unknown): string {
  if (value == null || typeof value === "boolean") {
    return "";
  }

  if (Array.isArray(value)) {
    return value.map((item) => flattenText(item)).join(" ");
  }

  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  return "";
}

export function render(element: ReactElement) {
  let renderer!: ReactTestRenderer;

  act(() => {
    renderer = TestRenderer.create(element);
  });

  return {
    renderer,
    getTextContent() {
      return renderer.root
        .findAllByType(Text)
        .map((node: ReactTestInstance) => flattenText(node.props.children))
        .join(" ");
    },
  };
}
