import type { ReactNode } from "react";
import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView as ContextSafeAreaView } from "react-native-safe-area-context";

import { webTheme } from "@/theme/webTheme";

import { MobileScreenHeader } from "./MobileScreenHeader";

type MobileScreenShellProps = {
  children: ReactNode;
  scroll?: boolean;
  bottomInset?: number;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  title?: string;
  onOpenMenu?: () => void;
  menuAccessibilityLabel?: string;
  headerTestID?: string;
};

export function MobileScreenShell({
  children,
  scroll = false,
  bottomInset = 0,
  style,
  contentStyle,
  title,
  onOpenMenu,
  menuAccessibilityLabel,
  headerTestID,
}: MobileScreenShellProps) {
  const SafeAreaView = ContextSafeAreaView ?? View;
  const showHeader = title && onOpenMenu;
  const content = (
    <View
      style={[
        styles.content,
        bottomInset > 0 ? { paddingBottom: bottomInset } : null,
        contentStyle,
      ]}
    >
      {children}
    </View>
  );

  return (
    <SafeAreaView style={[styles.shell, style]} testID="mobile-screen-shell">
      {showHeader ? (
        <View style={styles.headerWrap}>
          <MobileScreenHeader
            accessibilityLabel={menuAccessibilityLabel}
            onOpenMenu={onOpenMenu}
            testID={headerTestID}
            title={title}
          />
        </View>
      ) : null}
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: webTheme.colors.background,
  },
  headerWrap: {
    paddingHorizontal: webTheme.spacing.lg,
    paddingTop: 35,
  },
  content: {
    flex: 1,
    paddingHorizontal: webTheme.spacing.lg,
    paddingTop: webTheme.spacing.lg,
  },
  scrollContent: {
    flexGrow: 1,
  },
});
