import { webTheme } from "@/theme/webTheme";

import { resolveVoiceUiState } from "./voice-ui-state";

describe("resolveVoiceUiState", () => {
  it("maps recording to the listening visual state", () => {
    expect(
      resolveVoiceUiState({
        status: "connected",
        isRecording: true,
        isListening: false,
        isPlaying: false,
      }),
    ).toMatchObject({
      phase: "recording",
      connectionLabel: "Падключана",
      statusLabel: "Слухаю фразу...",
      accentColor: webTheme.colors.listening,
      icon: "🎙",
      shouldAnimateVisualizer: true,
    });
  });

  it("uses a concise listening label while waiting for speech", () => {
    expect(
      resolveVoiceUiState({
        status: "connected",
        isRecording: false,
        isListening: true,
        isPlaying: false,
      }),
    ).toMatchObject({
      phase: "listening",
      statusLabel: "Слухаю...",
    });
  });

  it("keeps processing amber even when audio is not playing", () => {
    expect(
      resolveVoiceUiState({
        status: "processing",
        isRecording: false,
        isListening: true,
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
        isListening: false,
        isPlaying: true,
      }),
    ).toMatchObject({
      phase: "speaking",
      connectionLabel: "Адказваю",
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
        isListening: false,
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
        isListening: false,
        isPlaying: false,
      }),
    ).toMatchObject({
      phase: "error",
      connectionLabel: "Памылка",
      accentColor: webTheme.colors.danger,
    });
  });
});
