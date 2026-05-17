import { KeyboardAvoidingView, Platform, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";

import { createChatApiClient } from "@/lib/api";
import { getRuntimeEnv } from "@/lib/env";
import { getSupabaseSession } from "@/lib/supabase";
import { pickSingleAttachment } from "@/lib/file-picker";
import { webGlassPanel, webTextStyles, webTheme } from "@/theme/webTheme";

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
  const controller = useChatController({
    api: defaultChatApi,
    pickAttachment: pickSingleAttachment,
  });

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.bgGlowTop} />
      <View style={styles.bgGlowBottom} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.header}>
          <View style={styles.titleBlock}>
            <Text style={styles.kicker}>Chat</Text>
            <Text style={styles.title}>Ask, upload, and keep context</Text>
          </View>
          <Pressable onPress={() => void controller.clearHistory()} style={styles.clearButton}>
            <Text style={styles.clearText}>Clear</Text>
          </Pressable>
        </View>

        {controller.error ? <Text style={styles.error}>{controller.error}</Text> : null}
        {controller.isLoadingHistory ? (
          <Text style={styles.loading}>Loading history...</Text>
        ) : null}

        <View style={styles.messages}>
          <MessageList messages={controller.messages} />
        </View>

        <Composer
          attachment={controller.attachment}
          draftText={controller.draftText}
          isSending={controller.isSending}
          onAttach={controller.pickAttachment}
          onChangeDraftText={controller.setDraftText}
          onClearAttachment={controller.clearAttachment}
          onSend={controller.sendMessage}
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
    backgroundColor: "rgba(78, 130, 238, 0.13)",
  },
  bgGlowBottom: {
    position: "absolute",
    right: -90,
    bottom: 120,
    width: 270,
    height: 270,
    borderRadius: 135,
    backgroundColor: "rgba(130, 78, 238, 0.12)",
  },
  flex: {
    flex: 1,
  },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  titleBlock: {
    flex: 1,
    gap: 4,
  },
  kicker: {
    ...webTextStyles.eyebrow,
  },
  title: {
    color: webTheme.colors.text,
    fontSize: 24,
    fontWeight: "800",
    lineHeight: 30,
  },
  clearButton: {
    borderRadius: 999,
    ...webGlassPanel,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  clearText: {
    color: webTheme.colors.text,
    fontWeight: "700",
  },
  error: {
    color: webTheme.colors.danger,
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
