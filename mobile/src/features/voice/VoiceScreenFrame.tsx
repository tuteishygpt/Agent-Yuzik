import type { ReactNode } from "react";
import { ScrollView, StyleSheet } from "react-native";

import { MobileScreenShell } from "@/components/mobile";

type VoiceScreenFrameProps = {
  children: ReactNode;
  bottomControls: ReactNode;
  title?: string;
  onOpenMenu?: () => void;
  menuAccessibilityLabel?: string;
  headerTestID?: string;
};

export function VoiceScreenFrame({
  children,
  bottomControls,
  title,
  onOpenMenu,
  menuAccessibilityLabel,
  headerTestID,
}: VoiceScreenFrameProps) {
  return (
    <MobileScreenShell
      contentStyle={styles.shellContent}
      headerTestID={headerTestID}
      menuAccessibilityLabel={menuAccessibilityLabel}
      onOpenMenu={onOpenMenu}
      title={title}
    >
      <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>
      {bottomControls}
    </MobileScreenShell>
  );
}

const styles = StyleSheet.create({
  shellContent: {
    paddingHorizontal: 0,
    paddingTop: 0,
  },
  content: {
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingBottom: 28,
    paddingTop: 35,
  },
});
