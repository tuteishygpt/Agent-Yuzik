import React from "react";
import { Modal, StyleSheet, Text } from "react-native";
import { act } from "react-test-renderer";

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
        "tab.teacher": "Classes",
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
  const { Pressable, Text } = require("react-native");

  function MockMenuButton() {
    const { useMenu } = require("@/navigation/MenuContext");
    const { openMenu } = useMenu();

    return (
      <Pressable accessibilityLabel="Mock open menu" onPress={openMenu}>
        <Text>mock-open-menu</Text>
      </Pressable>
    );
  }

  function Tabs({ children }: { children: React.ReactNode }) {
    return (
      <>
        <MockMenuButton />
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
    useRouter: () => ({
      replace: jest.fn(),
    }),
    useSegments: () => ["(tabs)", "voice"],
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

    expect(screen.getTextContent()).toContain("tab:voice:undefined");
  });

  it("includes the teacher tab in the protected menu routes", () => {
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

    expect(screen.getTextContent()).toContain("tab:teacher:undefined");
  });

  it("anchors the shared mobile menu to the Figma screen frame instead of the active tab content", () => {
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

    const openMenu = screen.renderer.root.findByProps({
      accessibilityLabel: "Mock open menu",
    });
    act(() => {
      openMenu.props.onPress();
    });

    const modal = screen.renderer.root.findByType(Modal);
    const overlay = modal.findByProps({ testID: "mobile-menu-overlay" });
    const menuAnchor = modal.findByProps({ testID: "mobile-menu-anchor" });
    const overlayStyle = StyleSheet.flatten(overlay.props.style);
    const menuAnchorStyle = StyleSheet.flatten(menuAnchor.props.style);

    expect(overlayStyle.justifyContent).toBeUndefined();
    expect(menuAnchorStyle.position).toBe("absolute");
    expect(menuAnchorStyle.left).toBe(40);
    expect(menuAnchorStyle.top).toBe(39);
    expect(menuAnchorStyle.paddingBottom).toBeUndefined();
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
