import React from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

import {
  useVoiceSettings,
  VoiceSettingsProvider,
} from "./VoiceSettingsProvider";

const mockGetItemAsync = jest.fn();
const mockSetItemAsync = jest.fn();

jest.mock("expo-secure-store", () => ({
  getItemAsync: (...args: [string]) => mockGetItemAsync(...args),
  setItemAsync: (...args: [string, string]) => mockSetItemAsync(...args),
}));

function Probe() {
  const settings = useVoiceSettings();

  return (
    <Text onPress={() => settings.setPreferNativeTenVad(false)}>
      {settings.preferNativeTenVad ? "native" : "energy"}
    </Text>
  );
}

describe("VoiceSettingsProvider", () => {
  beforeEach(() => {
    mockGetItemAsync.mockReset();
    mockSetItemAsync.mockReset();
  });

  it("defaults to energy VAD when no setting is stored", async () => {
    mockGetItemAsync.mockResolvedValue(null);

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <VoiceSettingsProvider>
          <Probe />
        </VoiceSettingsProvider>,
      );
      await Promise.resolve();
    });

    expect(renderer.root.findByType(Text).props.children).toBe("energy");
  });

  it("loads the stored energy VAD setting and persists changes", async () => {
    mockGetItemAsync.mockResolvedValue("0");

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <VoiceSettingsProvider>
          <Probe />
        </VoiceSettingsProvider>,
      );
      await Promise.resolve();
    });

    expect(renderer.root.findByType(Text).props.children).toBe("energy");

    await act(async () => {
      renderer.root.findByType(Text).props.onPress();
      await Promise.resolve();
    });

    expect(mockSetItemAsync).toHaveBeenCalledWith(
      "yuzik.voice.prefer_native_ten_vad",
      "0",
    );
  });
});
