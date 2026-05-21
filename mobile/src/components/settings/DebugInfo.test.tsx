import React from "react";

import { render } from "@/test/render";

import SettingsScreen from "../../../app/(tabs)/settings";

const mockOpenMenu = jest.fn();

jest.mock("@/navigation/MenuContext", () => ({
  useMenu: () => ({
    openMenu: mockOpenMenu,
  }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 24, left: 0, right: 0, top: 0 }),
}));

jest.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    locale: "en",
    setLocale: jest.fn(),
    t: (key: string) => {
      const map: Record<string, string> = {
        "settings.eyebrow": "Settings",
        "settings.title": "Settings",
        "settings.subtitle": "Environment and build diagnostics.",
        "settings.language": "Language",
        "settings.authLoading": "Loading auth",
        "settings.signedOut": "Signed out",
        "settings.guest": "Guest session",
        "settings.email": "Email account",
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      version: "9.9.9",
      extra: {
        buildProfile: "internal-preview",
        publicEnv: {
          backendUrl: "https://api.yuzik.example",
          supabaseUrl: "https://project.supabase.co",
          supabaseAnonKey: "super-secret-anon-key",
          appScheme: "yuzik-dev",
          buildChannel: "channel-beta",
          debugMenuEnabled: true,
          debugNetworkLoggingEnabled: false,
        },
      },
    },
  },
}));

describe("SettingsScreen", () => {
  it("renders runtime values through the real settings screen without leaking the anon key", () => {
    const screen = render(<SettingsScreen />);

    const text = screen.getTextContent();

    expect(text).toContain("Settings");
    expect(text).toContain("☰");
    expect(text).toContain("https://api.yuzik.example");
    expect(text).toContain("https://project.supabase.co");
    expect(text).toContain("Build channel channel-beta");
    expect(text).toContain("Build profile internal-preview");
    expect(text).toContain("App version 9.9.9");
    expect(text).toContain("Auth state Signed out");
    expect(text).toContain("Signed out");
    expect(text).toContain("Enabled");
    expect(text).toContain("Disabled");
    expect(text).not.toContain("super-secret-anon-key");
  });
});
