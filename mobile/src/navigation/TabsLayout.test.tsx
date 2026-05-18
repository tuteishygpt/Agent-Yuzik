import React from "react";
import { Text } from "react-native";

import { render } from "@/test/render";

import TabsLayout from "../../app/(tabs)/_layout";

const mockUseAuth = jest.fn();

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    locale: "en",
    setLocale: jest.fn(),
    t: (key: string) => {
      const map: Record<string, string> = {
        "tab.chat": "Chat",
        "tab.voice": "Voice",
        "tab.settings": "Settings",
        "auth.unavailable": "Auth unavailable",
        "auth.preparing": "Preparing secure session",
        "auth.errorDefault": "Unable to prepare a Supabase session.",
      };
      return map[key] ?? key;
    },
  }),
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
