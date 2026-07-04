import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { createChatApiClient, type ChatApiClient, type ChatHistoryMessage, type ChatUploadFile } from "@/lib/api";
import { createArtifactFetcher, type ArtifactFetcher, type ResolvedArtifact } from "@/lib/artifact-fetch";
import { playChatAudioArtifact } from "@/lib/chat-audio-playback";
import { type ChatAttachment, pickSingleAttachment } from "@/lib/file-picker";
import { getRuntimeEnv } from "@/lib/env";
import { getLegacyMobileUserId } from "@/lib/legacy-user-id";
import { getSupabaseSession } from "@/lib/supabase";

export type ChatResolvedArtifact = ResolvedArtifact & {
  kind: "image" | "audio";
  play?: () => Promise<void>;
};

export type ChatMessage = ChatHistoryMessage & {
  id: string;
  artifact: ChatResolvedArtifact | null;
  artifactError?: string | null;
};

export type ChatController = {
  messages: ChatMessage[];
  draftText: string;
  setDraftText: Dispatch<SetStateAction<string>>;
  attachment: ChatAttachment | null;
  setAttachment: Dispatch<SetStateAction<ChatAttachment | null>>;
  isLoadingHistory: boolean;
  isSending: boolean;
  error: string | null;
  pickAttachment: () => Promise<void>;
  clearAttachment: () => void;
  sendMessage: () => Promise<void>;
  clearHistory: () => Promise<void>;
};

type UseChatControllerOptions = {
  api?: ChatApiClient;
  artifactFetcher?: ArtifactFetcher;
  pickAttachment?: () => Promise<ChatAttachment | null>;
  playAudioArtifact?: (uri: string) => Promise<void>;
};

function createDefaultApi(): ChatApiClient {
  return createChatApiClient({
    backendUrl: getRuntimeEnv().backendUrl,
    getAccessToken: async () => (await getSupabaseSession())?.access_token ?? null,
    getLegacyUserId: getLegacyMobileUserId,
  });
}

function createDefaultArtifactFetcher(api: ChatApiClient): ArtifactFetcher {
  return createArtifactFetcher({
    api,
  });
}

function createMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toViewMessages(messages: ChatHistoryMessage[]): ChatMessage[] {
  return messages.map((message, index) => ({
    ...message,
    id: createMessageId(`history-${index}`),
    artifact: null,
    artifactError: null,
  }));
}

function getArtifactId(artifactUrl: string): string | null {
  const normalizedUrl = artifactUrl.replace(/^https?:\/\/[^/]+/i, "");
  const match = /\/api\/files\/([^/?#]+)/.exec(normalizedUrl);

  return match ? decodeURIComponent(match[1]) : null;
}

function getSignedUrlArtifactId(artifactUrl: string): string {
  let hash = 0;

  for (let index = 0; index < artifactUrl.length; index += 1) {
    hash = Math.imul(31, hash) + artifactUrl.charCodeAt(index);
    hash |= 0;
  }

  return `url-${Math.abs(hash).toString(36)}`;
}

function getArtifactFilename(artifactId: string, artifactKind: "image" | "audio"): string {
  if (/\.[a-z0-9]+$/i.test(artifactId)) {
    return artifactId;
  }

  return `${artifactId}.${artifactKind === "image" ? "png" : "mp3"}`;
}

async function resolveAssistantArtifact(
  response: Awaited<ReturnType<ChatApiClient["sendMessage"]>>,
  artifactFetcher: ArtifactFetcher,
  cacheKeyPrefix: string,
  playAudioArtifact: (uri: string) => Promise<void>,
): Promise<{
  artifact: ChatResolvedArtifact | null;
  artifactError: string | null;
}> {
  const artifactUrl = response.image ?? response.audio ?? null;
  const artifactKind = response.image
    ? "image"
    : response.audio
      ? "audio"
      : null;

  if (!artifactUrl || !artifactKind) {
    return {
      artifact: null,
      artifactError: null,
    };
  }

  const artifactId = getArtifactId(artifactUrl) ?? getSignedUrlArtifactId(artifactUrl);
  const sourceUrl = getArtifactId(artifactUrl) ? null : artifactUrl;

  try {
    const resolvedArtifact = await artifactFetcher.resolveArtifact({
      artifactId,
      ...(artifactKind === "audio" ? { cacheKey: `${cacheKeyPrefix}-${artifactId}` } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
      mimeType: artifactKind === "image" ? "image/*" : "audio/*",
      filename: getArtifactFilename(artifactId, artifactKind),
    });

    return {
      artifact: {
        ...resolvedArtifact,
        kind: artifactKind,
        ...(artifactKind === "audio"
          ? { play: () => playAudioArtifact(resolvedArtifact.localUri) }
          : {}),
      },
      artifactError: null,
    };
  } catch (error) {
    return {
      artifact: null,
      artifactError:
        error instanceof Error ? error.message : "Assistant artifact could not be loaded.",
    };
  }
}

async function buildAssistantMessage(
  response: Awaited<ReturnType<ChatApiClient["sendMessage"]>>,
  artifactFetcher: ArtifactFetcher,
  playAudioArtifact: (uri: string) => Promise<void>,
): Promise<ChatMessage> {
  const id = createMessageId("assistant");
  const resolvedArtifact = await resolveAssistantArtifact(
    response,
    artifactFetcher,
    id,
    playAudioArtifact,
  );

  return {
    id,
    role: "assistant",
    content: response.text ?? "",
    artifact: resolvedArtifact.artifact,
    artifactError: resolvedArtifact.artifactError,
  };
}

function isAudioAttachment(attachment: ChatAttachment | null): boolean {
  return attachment?.mimeType?.startsWith("audio/") ?? false;
}

function buildUserMessage(
  text: string,
  attachment: ChatAttachment | null,
  playAudioArtifact: (uri: string) => Promise<void>,
): ChatMessage {
  const audioAttachment = attachment && isAudioAttachment(attachment) ? attachment : null;

  return {
    id: createMessageId("user"),
    role: "user",
    content: text || (audioAttachment ? "" : attachment?.name || "Attachment"),
    artifact: audioAttachment
      ? {
          kind: "audio",
          localUri: audioAttachment.uri,
          presentation: "preview",
          openInSystem: async () => {
            await playAudioArtifact(audioAttachment.uri);
          },
          share: async () => {},
          play: async () => {
            await playAudioArtifact(audioAttachment.uri);
          },
        }
      : null,
    artifactError: null,
  };
}

function toUploadFile(attachment: ChatAttachment): ChatUploadFile {
  return {
    uri: attachment.uri,
    name: attachment.name,
    type: attachment.mimeType ?? undefined,
    blob: attachment.blob,
  };
}

export function useChatController({
  api,
  artifactFetcher,
  pickAttachment = pickSingleAttachment,
  playAudioArtifact = playChatAudioArtifact,
}: UseChatControllerOptions = {}): ChatController {
  const apiRef = useRef<ChatApiClient | null>(null);
  const artifactFetcherRef = useRef<ArtifactFetcher | null>(null);
  const pickAttachmentRef = useRef(pickAttachment);
  const playAudioArtifactRef = useRef(playAudioArtifact);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draftText, setDraftText] = useState("");
  const [attachment, setAttachment] = useState<ChatAttachment | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const sendingRef = useRef(false);

  if (!apiRef.current) {
    apiRef.current = api ?? createDefaultApi();
  }

  if (!artifactFetcherRef.current) {
    artifactFetcherRef.current =
      artifactFetcher ?? createDefaultArtifactFetcher(apiRef.current);
  }

  pickAttachmentRef.current = pickAttachment;
  playAudioArtifactRef.current = playAudioArtifact;

  useEffect(() => {
    mountedRef.current = true;

    void (async () => {
      try {
        setIsLoadingHistory(true);
        const history = await apiRef.current!.getHistory();

        if (!mountedRef.current) {
          return;
        }

        setMessages(toViewMessages(history));
      } catch (nextError) {
        if (!mountedRef.current) {
          return;
        }

        setError(nextError instanceof Error ? nextError.message : "Unable to load chat history.");
      } finally {
        if (mountedRef.current) {
          setIsLoadingHistory(false);
        }
      }
    })();

    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function handlePickAttachment(): Promise<void> {
    const nextAttachment = await pickAttachmentRef.current();
    setAttachment(nextAttachment);
  }

  function handleClearAttachment(): void {
    setAttachment(null);
  }

  async function handleSendMessage(): Promise<void> {
    if (sendingRef.current) {
      return;
    }

    const trimmedDraft = draftText.trim();

    if (!trimmedDraft && !attachment) {
      return;
    }

    sendingRef.current = true;
    setIsSending(true);
    setError(null);
    const sentAttachment = attachment;
    const userMessage = buildUserMessage(
      trimmedDraft,
      sentAttachment,
      playAudioArtifactRef.current,
    );
    setMessages((current) => [...current, userMessage]);
    setDraftText("");
    setAttachment(null);

    try {
      const response = await apiRef.current!.sendMessage({
        text: trimmedDraft,
        files: sentAttachment ? [toUploadFile(sentAttachment)] : undefined,
      });
      const assistantMessage = await buildAssistantMessage(
        response,
        artifactFetcherRef.current!,
        playAudioArtifactRef.current,
      );

      setMessages((current) => [...current, assistantMessage]);

      if (assistantMessage.artifact?.kind === "audio") {
        void assistantMessage.artifact
          .play?.()
          .catch((playbackError) => {
            if (mountedRef.current) {
              setError(
                playbackError instanceof Error
                  ? playbackError.message
                  : "Unable to play audio.",
              );
            }
          });
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to send message.");
    } finally {
      sendingRef.current = false;
      setIsSending(false);
    }
  }

  async function handleClearHistory(): Promise<void> {
    await apiRef.current!.clearHistory();
    setMessages([]);
    setDraftText("");
    setAttachment(null);
    setError(null);
  }

  return {
    messages,
    draftText,
    setDraftText,
    attachment,
    setAttachment,
    isLoadingHistory,
    isSending,
    error,
    pickAttachment: handlePickAttachment,
    clearAttachment: handleClearAttachment,
    sendMessage: handleSendMessage,
    clearHistory: handleClearHistory,
  };
}
