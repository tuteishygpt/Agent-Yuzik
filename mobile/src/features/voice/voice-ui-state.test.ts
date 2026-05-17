import { webTheme } from "@/theme/webTheme";

import { resolveVoiceUiState } from "./voice-ui-state";

describe("resolveVoiceUiState", () => {
  it("maps recording to the listening visual state", () => {
    expect(
      resolveVoiceUiState({
        status: "connected",
        isRecording: true,
        isPlaying: false,
      }),
    ).toMatchObject({
      phase: "recording",
      connectionLabel: "Падключана",
      statusLabel: "Слухаю...",
      accentColor: webTheme.colors.listening,
      icon: "🎙",
      shouldAnimateVisualizer: true,
    });
  });

  it("keeps processing amber even when audio is not playing", () => {
    expect(
      resolveVoiceUiState({
        status: "processing",
        isRecording: false,
        isPlaying: false,
      }),
    ).toMatchObject({
      phase: "processing",
      connectionLabel: "Думаю",
      statusLabel: "Думаю...",
      accentColor: webTheme.colors.processing,
      icon: "✹",
      shouldAnimateVisualizer: true,
    });
  });

  it("maps playback to the speaking visual state", () => {
    expect(
      resolveVoiceUiState({
        status: "connected",
        isRecording: false,
        isPlaying: true,
      }),
    ).toMatchObject({
      phase: "speaking",
      statusLabel: "Юзік адказвае...",
      accentColor: webTheme.colors.speaking,
      icon: "🔊",
    });
  });

  it("surfaces connection and error labels", () => {
    expect(
      resolveVoiceUiState({
        status: "connecting",
        isRecording: false,
        isPlaying: false,
      }),
    ).toMatchObject({
      phase: "connecting",
      connectionLabel: "Падключэнне",
      shouldPulseConnection: true,
    });

    expect(
      resolveVoiceUiState({
        status: "error",
        isRecording: false,
        isPlaying: false,
      }),
    ).toMatchObject({
      phase: "error",
      connectionLabel: "Памылка",
      accentColor: webTheme.colors.danger,
    });
  });
});
