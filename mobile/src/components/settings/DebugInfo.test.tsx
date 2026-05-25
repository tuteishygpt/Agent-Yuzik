import React from "react";

import { render } from "@/test/render";

import SettingsScreen from "../../../app/(tabs)/settings";

const mockOpenMenu = jest.fn();
const mockSetPreferNativeTenVad = jest.fn();
let mockPreferNativeTenVad = true;

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
        "settings.voice": "Voice detection",
        "settings.nativeTenVad": "Native TEN VAD",
        "settings.nativeTenVadDescription":
          "Use the Android native TEN VAD detector. Turn this off on emulators if voice input or playback gets unstable.",
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock("@/providers/VoiceSettingsProvider", () => ({
  useVoiceSettings: () => ({
    preferNativeTenVad: mockPreferNativeTenVad,
    setPreferNativeTenVad: mockSetPreferNativeTenVad,
  }),
}));

describe("SettingsScreen", () => {
  it("keeps teacher mode and build debug info out of settings", () => {
    const screen = render(<SettingsScreen />);
    const text = screen.getTextContent();

    expect(text).toContain("Settings");
    expect(text).toContain("Language");
    expect(text).not.toContain("Build and debug info");
    expect(text).not.toContain("Рэжым настаўніка");
    expect(text).not.toContain("Уключыць рэжым настаўніка");
  });

  it("shows the VAD mode switch and updates the setting", () => {
    mockPreferNativeTenVad = true;
    mockSetPreferNativeTenVad.mockClear();

    const screen = render(<SettingsScreen />);
    const text = screen.getTextContent();

    expect(text).toContain("Voice detection");
    expect(text).toContain("Native TEN VAD");

    const vadSwitch = screen.renderer.root.findByProps({
      accessibilityLabel: "Native TEN VAD",
    });

    vadSwitch.props.onValueChange(false);

    expect(mockSetPreferNativeTenVad).toHaveBeenCalledWith(false);
  });
});
