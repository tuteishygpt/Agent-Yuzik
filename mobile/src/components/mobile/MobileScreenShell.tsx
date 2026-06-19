import type { ReactNode } from "react";
import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { webTheme } from "@/theme/webTheme";

type MobileScreenShellProps = {
  children: ReactNode;
  scroll?: boolean;
  bottomInset?: number;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
};

export function MobileScreenShell({
  children,
  scroll = false,
  bottomInset = 0,
  style,
  contentStyle,
}: MobileScreenShellProps) {
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
  content: {
    flex: 1,
    paddingHorizontal: webTheme.spacing.lg,
    paddingTop: webTheme.spacing.lg,
  },
  scrollContent: {
    flexGrow: 1,
  },
});
