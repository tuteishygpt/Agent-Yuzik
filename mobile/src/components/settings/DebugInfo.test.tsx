import React from "react";

import { render } from "@/test/render";

import SettingsScreen from "../../../app/(tabs)/settings";

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
