import type { ReactNode } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

import { MobileStatusPill, YuzikAvatar, type YuzikAvatarState } from "@/components/mobile";
import { webTheme } from "@/theme/webTheme";

import { TranscriptPanel } from "./TranscriptPanel";
import type { VoiceTranscriptEntry } from "./useVoiceSession";
import type { VoiceUiState } from "./voice-ui-state";
import { VoiceVisualizer } from "./VoiceVisualizer";

type VoiceStageProps = {
  title?: string;
  eyebrow?: string;
  connectionLabel?: string;
  compact?: boolean;
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
  showStatusPill?: boolean;
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

function emptyTranscriptTextForPhase(phase: VoiceUiState["phase"]): string {
  if (phase === "listening" || phase === "recording") {
    return "Гаварыце...";
  }

  return "Размова яшчэ не пачалася";
}

export function VoiceStage({
  title,
  eyebrow,
  connectionLabel,
  compact = false,
  uiState,
  visualizerPulse,
  animatedStyles,
  transcript,
  notice,
  error,
  onPrimaryPress,
  childrenBeforeStage,
  showStatusPill = true,
}: VoiceStageProps) {
  const avatarState = avatarStateForPhase(uiState.phase);

  return (
    <View style={[styles.stage, compact ? styles.stageCompact : null]}>
      {showStatusPill ? (
        <View style={styles.topRow}>
          <MobileStatusPill
            animatedDotStyle={animatedStyles.dot}
            label={connectionLabel ?? uiState.connectionLabel}
            tone={statusToneForPhase(uiState.phase)}
          />
        </View>
      ) : null}

      <View style={[styles.hero, compact ? styles.heroCompact : null]}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        {title ? <Text style={styles.title}>{title}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      {childrenBeforeStage}

      <Pressable
        onPress={onPrimaryPress}
        style={[styles.pressable, compact ? styles.pressableCompact : null]}
        testID="voice-stage-pressable"
      >
        <Animated.View
          style={[
            styles.halo,
            compact ? styles.haloCompact : null,
            { backgroundColor: uiState.haloColor },
            animatedStyles.halo,
          ]}
        />
        <Animated.View style={[styles.avatarFrame, animatedStyles.mic]}>
          <YuzikAvatar size={compact ? "figma" : "lg"} state={avatarState} />
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
      <TranscriptPanel
        compact={compact}
        emptyText={emptyTranscriptTextForPhase(uiState.phase)}
        transcript={transcript}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    width: "100%",
    alignItems: "center",
    gap: 14,
  },
  stageCompact: {
    gap: 9,
  },
  topRow: {
    width: "100%",
    minHeight: 27,
    alignItems: "flex-start",
  },
  hero: {
    width: "100%",
    alignItems: "center",
    gap: 7,
  },
  heroCompact: {
    gap: 4,
  },
  eyebrow: {
    color: webTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  title: {
    color: webTheme.colors.text,
    fontSize: 17,
    fontWeight: "700",
    lineHeight: 25,
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
    height: 206,
    alignItems: "center",
    justifyContent: "center",
  },
  pressableCompact: {
    height: 150,
  },
  halo: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    opacity: 0.16,
  },
  haloCompact: {
    width: 168,
    height: 168,
    borderRadius: 84,
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
