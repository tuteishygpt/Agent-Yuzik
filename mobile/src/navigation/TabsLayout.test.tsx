import React from "react";
import { Text } from "react-native";

import { render } from "@/test/render";

import TabsLayout from "../../app/(tabs)/_layout";

const mockUseAuth = jest.fn();

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock("expo-router", () => {
  const React = require("react");
  const { Text } = require("react-native");

  function Tabs({ children }: { children: React.ReactNode }) {
    return (
      <>
        <Text>tabs-ready</Text>
        {children}
      </>
    );
  }

  Tabs.Screen = ({ name, options }: { name: string; options?: { title?: string } }) => (
    <Text>{`tab:${name}:${options?.title}`}</Text>
  );

  return {
    Tabs,
  };
});

describe("TabsLayout protected routes", () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
  });

  it("does not render tab routes while auth is loading", () => {
    mockUseAuth.mockReturnValue({
      status: "loading",
      session: null,
      error: null,
    });

    const screen = render(<TabsLayout />);

    expect(screen.getTextContent()).toContain("Preparing secure session");
    expect(screen.getTextContent()).not.toContain("tabs-ready");
  });

  it("renders tab routes after a Supabase session is ready", () => {
    mockUseAuth.mockReturnValue({
      status: "ready",
      session: {
        access_token: "access-token",
        user: {
          id: "user-id",
        },
      },
      error: null,
    });

    const screen = render(<TabsLayout />);

    expect(screen.getTextContent()).toContain("tabs-ready");
  });

  it("includes the voice tab after a Supabase session is ready", () => {
    mockUseAuth.mockReturnValue({
      status: "ready",
      session: {
        access_token: "access-token",
        user: {
          id: "user-id",
        },
      },
      error: null,
    });

    const screen = render(<TabsLayout />);

    expect(screen.getTextContent()).toContain("tab:voice:Voice");
  });

  it("renders an auth error instead of protected routes", () => {
    mockUseAuth.mockReturnValue({
      status: "error",
      session: null,
      error: new Error("Supabase is unavailable."),
    });

    const screen = render(<TabsLayout />);

    expect(screen.getTextContent()).toContain("Auth unavailable");
    expect(screen.getTextContent()).toContain("Supabase is unavailable.");
    expect(screen.getTextContent()).not.toContain("tabs-ready");
  });
});
