import type { ReactNode } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

import { MobileStatusPill, YuzikAvatar, type YuzikAvatarState } from "@/components/mobile";
import { webTheme } from "@/theme/webTheme";

import { TranscriptPanel } from "./TranscriptPanel";
import type { VoiceTranscriptEntry } from "./useVoiceSession";
import type { VoiceUiState } from "./voice-ui-state";
import { VoiceVisualizer } from "./VoiceVisualizer";

type VoiceStageProps = {
  title: string;
  eyebrow?: string;
  connectionLabel?: string;
  uiState: VoiceUiState;
  visualizerPulse: Animated.Value;
  animatedStyles: {
    dot?: object;
    halo?: object;
    mic?: object;
  };
  transcript: VoiceTranscriptEntry[];
  notice?: string | null;
  error?: string | null;
  onPrimaryPress: () => void;
  childrenBeforeStage?: ReactNode;
};

function avatarStateForPhase(phase: VoiceUiState["phase"]): YuzikAvatarState {
  if (phase === "recording" || phase === "listening") {
    return "listening";
  }

  if (phase === "processing") {
    return "thinking";
  }

  if (phase === "speaking") {
    return "speaking";
  }

  if (phase === "error") {
    return "error";
  }

  return "default";
}

function statusToneForPhase(
  phase: VoiceUiState["phase"],
): "neutral" | "accent" | "success" | "warning" | "danger" {
  if (phase === "error") {
    return "danger";
  }

  if (phase === "processing" || phase === "connecting") {
    return "warning";
  }

  if (phase === "speaking" || phase === "connected") {
    return "success";
  }

  if (phase === "recording" || phase === "listening") {
    return "accent";
  }

  return "neutral";
}

export function VoiceStage({
  title,
  eyebrow,
  connectionLabel,
  uiState,
  visualizerPulse,
  animatedStyles,
  transcript,
  notice,
  error,
  onPrimaryPress,
  childrenBeforeStage,
}: VoiceStageProps) {
  const avatarState = avatarStateForPhase(uiState.phase);

  return (
    <View style={styles.stage}>
      <View style={styles.topRow}>
        <MobileStatusPill
          animatedDotStyle={animatedStyles.dot}
          label={connectionLabel ?? uiState.connectionLabel}
          tone={statusToneForPhase(uiState.phase)}
        />
      </View>

      <View style={styles.hero}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.title}>{title}</Text>
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      {childrenBeforeStage}

      <Pressable
        onPress={onPrimaryPress}
        style={styles.pressable}
        testID="voice-stage-pressable"
      >
        <Animated.View
          style={[
            styles.halo,
            { backgroundColor: uiState.haloColor },
            animatedStyles.halo,
          ]}
        />
        <Animated.View style={[styles.avatarFrame, animatedStyles.mic]}>
          <YuzikAvatar size="lg" state={avatarState} />
        </Animated.View>
      </Pressable>

      <Text
        style={[
          styles.statusText,
          uiState.shouldAnimateVisualizer ? styles.statusTextActive : null,
        ]}
      >
        {uiState.statusLabel}
      </Text>

      <VoiceVisualizer pulse={visualizerPulse} uiState={uiState} />
      <TranscriptPanel transcript={transcript} />
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    width: "100%",
    alignItems: "center",
    gap: 16,
  },
  topRow: {
    width: "100%",
    alignItems: "flex-end",
  },
  hero: {
    width: "100%",
    alignItems: "center",
    gap: 7,
  },
  eyebrow: {
    color: webTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  title: {
    color: webTheme.colors.text,
    fontSize: 24,
    fontWeight: "800",
    lineHeight: 30,
    textAlign: "center",
  },
  notice: {
    color: webTheme.colors.processing,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  error: {
    color: webTheme.colors.danger,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  pressable: {
    width: "100%",
    height: 154,
    alignItems: "center",
    justifyContent: "center",
  },
  halo: {
    position: "absolute",
    width: 142,
    height: 142,
    borderRadius: 71,
    opacity: 0.16,
  },
  avatarFrame: {
    alignItems: "center",
    justifyContent: "center",
  },
  statusText: {
    minHeight: 24,
    color: webTheme.colors.textMuted,
    fontSize: 16,
    textAlign: "center",
  },
  statusTextActive: {
    color: webTheme.colors.text,
    fontWeight: "700",
  },
});
