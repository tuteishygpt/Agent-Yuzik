import { useEffect, useRef } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useI18n } from "@/lib/i18n";
import { createChatApiClient } from "@/lib/api";
import { getRuntimeEnv } from "@/lib/env";
import { getSupabaseSession } from "@/lib/supabase";
import { pickSingleAttachment } from "@/lib/file-picker";
import { useMenu } from "@/navigation/MenuContext";
import { webTheme } from "@/theme/webTheme";

import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { useChatController } from "./useChatController";

function createDefaultApi() {
  return createChatApiClient({
    backendUrl: getRuntimeEnv().backendUrl,
    getAccessToken: async () => (await getSupabaseSession())?.access_token ?? null,
  });
}

const defaultChatApi = createDefaultApi();

export default function ChatScreen() {
  const { t } = useI18n();
  const { openMenu } = useMenu();
  const controller = useChatController({
    api: defaultChatApi,
    pickAttachment: pickSingleAttachment,
  });
  const listRef = useRef<FlatList>(null);

  const handleSelectPrompt = (prompt: string) => {
    controller.setDraftText(prompt);
  };

  const scrollToEnd = () => {
    if (controller.messages.length > 0) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  };

  useEffect(() => {
    const timer = setTimeout(scrollToEnd, 0);
    return () => clearTimeout(timer);
  }, [controller.messages.length]);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.bgGlowTop} />
      <View style={styles.bgGlowBottom} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
        style={styles.flex}
      >
        <View style={styles.header}>
          <View style={styles.headerTitle}>
            <Text style={styles.logo}>🤖</Text>
            <Text style={styles.title}>Юзік</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable onPress={() => void controller.clearHistory()} style={styles.iconBtn}>
              <Text style={styles.iconBtnText}>🗑️</Text>
            </Pressable>
          </View>
        </View>

        {controller.error ? <Text style={styles.error}>{controller.error}</Text> : null}
        {controller.isLoadingHistory ? (
          <Text style={styles.loading}>{t("chat.loadingHistory")}</Text>
        ) : null}

        <View style={styles.messages}>
          <MessageList
            ref={listRef}
            messages={controller.messages}
            onSelectPrompt={handleSelectPrompt}
            onContentSizeChange={scrollToEnd}
          />
        </View>

        <Composer
          attachment={controller.attachment}
          draftText={controller.draftText}
          isSending={controller.isSending}
          onAttach={controller.pickAttachment}
          onChangeDraftText={controller.setDraftText}
          onClearAttachment={controller.clearAttachment}
          onSend={controller.sendMessage}
          onOpenMenu={openMenu}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: webTheme.colors.background,
  },
  bgGlowTop: {
    position: "absolute",
    top: -90,
    left: -80,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: webTheme.colors.bgGlowPrimary,
  },
  bgGlowBottom: {
    position: "absolute",
    right: -90,
    bottom: 120,
    width: 270,
    height: 270,
    borderRadius: 135,
    backgroundColor: webTheme.colors.bgGlowSecondary,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: webTheme.colors.border,
  },
  headerTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logo: {
    fontSize: 28,
  },
  title: {
    fontSize: 22,
    fontWeight: "600",
    color: webTheme.colors.primary,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: webTheme.colors.glassBg,
    borderWidth: 1,
    borderColor: webTheme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnText: {
    fontSize: 18,
  },
  error: {
    color: "#ff6688",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  loading: {
    color: webTheme.colors.textMuted,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  messages: {
    flex: 1,
  },
});
