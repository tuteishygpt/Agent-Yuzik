import { webTheme } from "@/theme/webTheme";

export type VoiceUiPhase =
  | "idle"
  | "connecting"
  | "connected"
  | "listening"
  | "recording"
  | "processing"
  | "speaking"
  | "error";

export type VoiceUiInput = {
  status: string;
  isRecording: boolean;
  isListening: boolean;
  isPlaying: boolean;
};

export type VoiceUiState = {
  phase: VoiceUiPhase;
  connectionLabel: string;
  statusLabel: string;
  accentColor: string;
  haloColor: string;
  icon: string;
  shouldAnimateMic: boolean;
  shouldAnimateHalo: boolean;
  shouldAnimateVisualizer: boolean;
  shouldPulseConnection: boolean;
};

function resolvePhase(input: VoiceUiInput): VoiceUiPhase {
  if (input.isPlaying) {
    return "speaking";
  }

  if (input.status === "processing") {
    return "processing";
  }

  if (input.isRecording) {
    return "recording";
  }

  if (input.isListening && !input.isRecording) {
    return "listening";
  }

  if (input.status === "connecting" || input.status === "reconnecting") {
    return "connecting";
  }

  if (input.status === "connected" || input.status === "reconnected") {
    return "connected";
  }

  if (input.status === "error") {
    return "error";
  }

  return "idle";
}

export function resolveVoiceUiState(input: VoiceUiInput): VoiceUiState {
  const phase = resolvePhase(input);

  if (phase === "listening") {
    return {
      phase,
      connectionLabel: "Падключана",
      statusLabel: "Чакаю голас...",
      accentColor: webTheme.colors.primary,
      haloColor: webTheme.colors.primaryGlow,
      icon: "🎙",
      shouldAnimateMic: false,
      shouldAnimateHalo: true,
      shouldAnimateVisualizer: false,
      shouldPulseConnection: false,
    };
  }

  if (phase === "recording") {
    return {
      phase,
      connectionLabel: "Падключана",
      statusLabel: "Слухаю фразу...",
      accentColor: webTheme.colors.listening,
      haloColor: webTheme.colors.listeningGlow,
      icon: "🎙",
      shouldAnimateMic: true,
      shouldAnimateHalo: true,
      shouldAnimateVisualizer: true,
      shouldPulseConnection: false,
    };
  }

  if (phase === "processing") {
    return {
      phase,
      connectionLabel: "Думаю",
      statusLabel: "Думаю...",
      accentColor: webTheme.colors.processing,
      haloColor: webTheme.colors.processingGlow,
      icon: "✹",
      shouldAnimateMic: true,
      shouldAnimateHalo: true,
      shouldAnimateVisualizer: true,
      shouldPulseConnection: false,
    };
  }

  if (phase === "speaking") {
    return {
      phase,
      connectionLabel: "Адказваю",
      statusLabel: "Юзік адказвае...",
      accentColor: webTheme.colors.speaking,
      haloColor: webTheme.colors.speakingGlow,
      icon: "🔊",
      shouldAnimateMic: true,
      shouldAnimateHalo: true,
      shouldAnimateVisualizer: true,
      shouldPulseConnection: false,
    };
  }

  if (phase === "connecting") {
    return {
      phase,
      connectionLabel: "Падключэнне",
      statusLabel: "Падключэнне...",
      accentColor: webTheme.colors.primary,
      haloColor: webTheme.colors.primaryGlow,
      icon: "🎙",
      shouldAnimateMic: false,
      shouldAnimateHalo: false,
      shouldAnimateVisualizer: false,
      shouldPulseConnection: true,
    };
  }

  if (phase === "connected") {
    return {
      phase,
      connectionLabel: "Падключана",
      statusLabel: "Націсніце на мікрафон для пачатку",
      accentColor: webTheme.colors.speaking,
      haloColor: webTheme.colors.primaryGlow,
      icon: "🎙",
      shouldAnimateMic: false,
      shouldAnimateHalo: false,
      shouldAnimateVisualizer: false,
      shouldPulseConnection: false,
    };
  }

  if (phase === "error") {
    return {
      phase,
      connectionLabel: "Памылка",
      statusLabel: "Праверце падключэнне і паспрабуйце яшчэ раз",
      accentColor: webTheme.colors.danger,
      haloColor: webTheme.colors.listeningBorder,
      icon: "🎙",
      shouldAnimateMic: false,
      shouldAnimateHalo: false,
      shouldAnimateVisualizer: false,
      shouldPulseConnection: false,
    };
  }

  return {
    phase,
    connectionLabel: "Адключана",
    statusLabel: "Націсніце на мікрафон для пачатку",
    accentColor: webTheme.colors.primary,
    haloColor: webTheme.colors.primaryGlow,
    icon: "🎙",
    shouldAnimateMic: true,
    shouldAnimateHalo: false,
    shouldAnimateVisualizer: false,
    shouldPulseConnection: false,
  };
}
