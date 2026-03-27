import { KeyboardAvoidingView, Platform, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";

import { createChatApiClient } from "@/lib/api";
import { getRuntimeEnv } from "@/lib/env";
import { getSupabaseSession } from "@/lib/supabase";
import { pickSingleAttachment } from "@/lib/file-picker";

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
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.header}>
          <View style={styles.titleBlock}>
            <Text style={styles.kicker}>Mobile chat</Text>
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
    backgroundColor: "#f7f9fc",
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
    color: "#667085",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: {
    color: "#101828",
    fontSize: 24,
    fontWeight: "800",
    lineHeight: 30,
  },
  clearButton: {
    borderRadius: 999,
    backgroundColor: "#eef4ff",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  clearText: {
    color: "#1849a9",
    fontWeight: "700",
  },
  error: {
    color: "#b42318",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  loading: {
    color: "#667085",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  messages: {
    flex: 1,
  },
});
