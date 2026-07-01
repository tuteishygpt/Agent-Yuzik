import { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { MobileScreenHeader, MobileScreenShell } from "@/components/mobile";
import { createChatApiClient } from "@/lib/api";
import { getRuntimeEnv } from "@/lib/env";
import { pickSingleAttachment } from "@/lib/file-picker";
import { getLegacyMobileUserId } from "@/lib/legacy-user-id";
import { getSupabaseSession } from "@/lib/supabase";
import { createVoiceRecorderAdapter, type VoiceRecorderAdapter } from "@/lib/audio-recording";
import { useMenu } from "@/navigation/MenuContext";
import { webTheme } from "@/theme/webTheme";

import { createVoiceAttachmentFromWavBytes } from "./chat-voice-attachment";
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

type ChatHeaderProps = {
  onOpenMenu: () => void;
  onClearHistory: () => void;
};

function TrashIcon() {
  return (
    <View style={styles.trashIcon} testID="chat-header-trash-icon">
      <View style={styles.trashLid} />
      <View style={styles.trashHandle} />
      <View style={styles.trashCan} />
      <View style={styles.trashLineLeft} />
      <View style={styles.trashLineRight} />
      <View style={styles.trashTopLine} />
    </View>
  );
}

export function ChatHeader({ onOpenMenu, onClearHistory }: ChatHeaderProps) {
  return (
    <View style={styles.header}>
      <MobileScreenHeader
        accessibilityLabel="Open chat menu"
        onOpenMenu={onOpenMenu}
        rightAccessory={
          <Pressable
            accessibilityLabel="Clear chat history"
            onPress={onClearHistory}
            style={styles.clearButton}
          >
            <TrashIcon />
          </Pressable>
        }
        testID="chat-screen-header"
        title="Чат"
      />
    </View>
  );
}

function LegacyChatHeader({ onOpenMenu, onClearHistory }: ChatHeaderProps) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityLabel="Open chat menu"
        onPress={onOpenMenu}
        style={styles.chatTab}
      >
        <View style={styles.chatTabIcon} testID="chat-header-menu-icon">
          <View style={styles.chatTabLine} />
          <View style={styles.chatTabLine} />
          <View style={styles.chatTabLine} />
        </View>
        <Text style={styles.chatTabText} testID="chat-header-title">
          Юзік
        </Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Clear chat history"
        onPress={onClearHistory}
        style={styles.clearButton}
      >
        <TrashIcon />
      </Pressable>
    </View>
  );
}

type ClearHistoryDialogProps = {
  onCancel: () => void;
  onConfirm: () => void;
};

function ClearHistoryDialog({ onCancel, onConfirm }: ClearHistoryDialogProps) {
  return (
    <View style={styles.confirmOverlay} testID="chat-clear-confirm-overlay">
      <View style={styles.confirmDialog}>
        <Text style={styles.confirmTitle}>
          Ці дакладна жадаеце выдаліць дыялог?
        </Text>
        <Pressable
          accessibilityLabel="Confirm clear chat history"
          onPress={onConfirm}
          style={styles.confirmDeleteButton}
        >
          <Text style={styles.confirmDeleteText}>Выдаліць чат</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Cancel clear chat history"
          onPress={onCancel}
          style={styles.confirmCancelButton}
        >
          <Text style={styles.confirmCancelText}>Вярнуцца да размовы</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function ChatScreen() {
  const { openMenu } = useMenu();
  const defaultChatApi = useMemo(createDefaultApi, []);
  const controller = useChatController({
    api: defaultChatApi,
    pickAttachment: pickSingleAttachment,
  });
  const listRef = useRef<FlatList>(null);
  const recorderRef = useRef<VoiceRecorderAdapter | null>(null);
  const recordingRef = useRef(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

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

  const startVoiceRecording = async () => {
    if (recordingRef.current || controller.isSending) {
      return;
    }

    const recorder = recorderRef.current ?? createVoiceRecorderAdapter();
    recorderRef.current = recorder;
    recordingRef.current = true;

    try {
      await recorder.prepare();
      await recorder.start();
      setIsRecordingVoice(true);
    } catch {
      recordingRef.current = false;
      setIsRecordingVoice(false);
    }
  };

  const confirmVoiceRecording = async () => {
    if (!recordingRef.current) {
      return;
    }

    const recorder = recorderRef.current;
    recordingRef.current = false;
    setIsRecordingVoice(false);

    if (!recorder) {
      return;
    }

    try {
      const result = await recorder.stop();
      const attachment = await createVoiceAttachmentFromWavBytes({
        wavBytes: result.wavBytes,
      });
      controller.setAttachment(attachment);
    } catch {
      // Keep chat usable if the platform returns no audio or recording fails.
    }
  };

  const cancelVoiceRecording = async () => {
    if (!recordingRef.current) {
      return;
    }

    const recorder = recorderRef.current;
    recordingRef.current = false;
    setIsRecordingVoice(false);

    try {
      await recorder?.stop();
    } catch {
      // Cancel should leave the composer ready even if native stop fails.
    }
  };

  const confirmClearHistory = async () => {
    setShowClearConfirm(false);
    await controller.clearHistory();
  };

  return (
    <MobileScreenShell contentStyle={styles.shellContent}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
        style={styles.flex}
      >
        <ChatHeader
          onClearHistory={() => setShowClearConfirm(true)}
          onOpenMenu={openMenu}
        />

        {controller.error ? <Text style={styles.error}>{controller.error}</Text> : null}

        <View style={styles.messages}>
          <MessageList
            isSending={controller.isSending}
            messages={controller.messages}
            onContentSizeChange={scrollToEnd}
            onSelectPrompt={handleSelectPrompt}
            ref={listRef}
            showStartScreen={!controller.draftText.trim()}
          />
        </View>

        <Composer
          attachment={controller.attachment}
          draftText={controller.draftText}
          isSending={controller.isSending}
          onAttach={controller.pickAttachment}
          onChangeDraftText={controller.setDraftText}
          onClearAttachment={controller.clearAttachment}
          onCancelVoiceRecording={cancelVoiceRecording}
          onConfirmVoiceRecording={confirmVoiceRecording}
          onOpenMenu={openMenu}
          onStartVoiceRecording={startVoiceRecording}
          onStopVoiceRecording={confirmVoiceRecording}
          onSend={controller.sendMessage}
          isRecordingVoice={isRecordingVoice}
        />
        {showClearConfirm ? (
          <ClearHistoryDialog
            onCancel={() => setShowClearConfirm(false)}
            onConfirm={() => {
              void confirmClearHistory();
            }}
          />
        ) : null}
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
    height: 70,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 35,
    backgroundColor: webTheme.colors.background,
  },
  chatTab: {
    width: 124,
    height: 27,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  chatTabIcon: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  chatTabLine: {
    width: 16,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: webTheme.colors.primary,
  },
  chatTabText: {
    color: webTheme.colors.text,
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 27,
  },
  clearButton: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  trashIcon: {
    width: 24,
    height: 24,
  },
  trashLid: {
    position: "absolute",
    left: 3,
    top: 7,
    width: 18,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: webTheme.colors.text,
  },
  trashHandle: {
    position: "absolute",
    left: 8,
    top: 4,
    width: 8,
    height: 4,
    borderTopWidth: 1.5,
    borderLeftWidth: 1.5,
    borderRightWidth: 1.5,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    borderColor: webTheme.colors.text,
  },
  trashCan: {
    position: "absolute",
    left: 5,
    top: 8,
    width: 14,
    height: 13,
    borderLeftWidth: 1.5,
    borderRightWidth: 1.5,
    borderBottomWidth: 1.5,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    borderColor: webTheme.colors.text,
  },
  trashLineLeft: {
    position: "absolute",
    left: 9,
    top: 12,
    width: 1.5,
    height: 6,
    borderRadius: 1,
    backgroundColor: webTheme.colors.text,
  },
  trashLineRight: {
    position: "absolute",
    right: 9,
    top: 12,
    width: 1.5,
    height: 6,
    borderRadius: 1,
    backgroundColor: webTheme.colors.text,
  },
  trashTopLine: {
    position: "absolute",
    left: 1,
    top: 7,
    width: 22,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: webTheme.colors.text,
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
  confirmOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 48,
    backgroundColor: "rgba(54, 36, 36, 0.72)",
  },
  confirmDialog: {
    width: "100%",
    maxWidth: 236,
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 18,
    borderRadius: 16,
    backgroundColor: webTheme.colors.surface,
    borderWidth: 1,
    borderColor: webTheme.colors.border,
  },
  confirmTitle: {
    maxWidth: 176,
    color: webTheme.colors.text,
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 18,
    textAlign: "center",
  },
  confirmDeleteButton: {
    width: "100%",
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
    backgroundColor: webTheme.colors.primary,
  },
  confirmDeleteText: {
    color: webTheme.colors.surface,
    fontSize: 14,
    fontWeight: "700",
  },
  confirmCancelButton: {
    width: "100%",
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
    backgroundColor: webTheme.colors.surface,
    borderWidth: 1,
    borderColor: webTheme.colors.border,
  },
  confirmCancelText: {
    color: webTheme.colors.primary,
    fontSize: 13,
    fontWeight: "700",
  },
});
