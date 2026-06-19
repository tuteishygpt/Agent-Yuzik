import { useEffect, useRef } from "react";
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";

import {
  MobileActionButton,
  MobileScreenShell,
  MobileStatusPill,
  YuzikAvatar,
} from "@/components/mobile";
import { createChatApiClient } from "@/lib/api";
import { getRuntimeEnv } from "@/lib/env";
import { pickSingleAttachment } from "@/lib/file-picker";
import { useI18n } from "@/lib/i18n";
import { getLegacyMobileUserId } from "@/lib/legacy-user-id";
import { getSupabaseSession } from "@/lib/supabase";
import { useMenu } from "@/navigation/MenuContext";
import { webTheme } from "@/theme/webTheme";

import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { useChatController } from "./useChatController";

function createDefaultApi() {
  return createChatApiClient({
    backendUrl: getRuntimeEnv().backendUrl,
    getAccessToken: async () => (await getSupabaseSession())?.access_token ?? null,
    getLegacyUserId: getLegacyMobileUserId,
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
    <MobileScreenShell contentStyle={styles.shellContent}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
        style={styles.flex}
      >
        <View style={styles.header}>
          <View style={styles.headerTitle}>
            <YuzikAvatar size="md" state={controller.isSending ? "thinking" : "default"} />
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Yuzik</Text>
              <MobileStatusPill
                label={
                  controller.isLoadingHistory
                    ? t("chat.loadingHistory")
                    : controller.isSending
                      ? "Thinking"
                      : "Ready"
                }
                tone={controller.error ? "danger" : controller.isSending ? "warning" : "accent"}
              />
            </View>
          </View>
          <MobileActionButton
            accessibilityLabel="Clear chat history"
            label="Clear"
            onPress={() => void controller.clearHistory()}
            variant="ghost"
          />
        </View>

        {controller.error ? <Text style={styles.error}>{controller.error}</Text> : null}

        <View style={styles.messages}>
          <MessageList
            isSending={controller.isSending}
            messages={controller.messages}
            onContentSizeChange={scrollToEnd}
            onSelectPrompt={handleSelectPrompt}
            ref={listRef}
          />
        </View>

        <Composer
          attachment={controller.attachment}
          draftText={controller.draftText}
          isSending={controller.isSending}
          onAttach={controller.pickAttachment}
          onChangeDraftText={controller.setDraftText}
          onClearAttachment={controller.clearAttachment}
          onOpenMenu={openMenu}
          onSend={controller.sendMessage}
        />
      </KeyboardAvoidingView>
    </MobileScreenShell>
  );
}

const styles = StyleSheet.create({
  shellContent: {
    paddingHorizontal: 0,
    paddingTop: 0,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: webTheme.colors.border,
    backgroundColor: webTheme.colors.background,
  },
  headerTitle: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    gap: 6,
  },
  title: {
    color: webTheme.colors.text,
    fontSize: 22,
    fontWeight: "800",
  },
  error: {
    color: webTheme.colors.danger,
    paddingHorizontal: 16,
    paddingTop: 10,
    fontSize: 13,
    fontWeight: "700",
  },
  messages: {
    flex: 1,
  },
});
