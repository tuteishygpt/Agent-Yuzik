import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { createChatApiClient, type ChatApiClient, type ChatHistoryMessage, type ChatUploadFile } from "@/lib/api";
import { createArtifactFetcher, type ArtifactFetcher, type ResolvedArtifact } from "@/lib/artifact-fetch";
import { type ChatAttachment, pickSingleAttachment } from "@/lib/file-picker";
import { getRuntimeEnv } from "@/lib/env";
import { getSupabaseSession } from "@/lib/supabase";

export type ChatResolvedArtifact = ResolvedArtifact & {
  kind: "image" | "audio";
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
};

function createDefaultApi(): ChatApiClient {
  return createChatApiClient({
    backendUrl: getRuntimeEnv().backendUrl,
    getAccessToken: async () => (await getSupabaseSession())?.access_token ?? null,
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

async function resolveAssistantArtifact(
  response: Awaited<ReturnType<ChatApiClient["sendMessage"]>>,
  artifactFetcher: ArtifactFetcher,
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

  const artifactId = getArtifactId(artifactUrl);

  if (!artifactId) {
    return {
      artifact: null,
      artifactError: "Assistant artifact URL could not be resolved.",
    };
  }

  try {
    const resolvedArtifact = await artifactFetcher.resolveArtifact({
      artifactId,
      mimeType: artifactKind === "image" ? "image/*" : "audio/*",
      filename: `${artifactId}.${artifactKind === "image" ? "png" : "mp3"}`,
    });

    return {
      artifact: {
        ...resolvedArtifact,
        kind: artifactKind,
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
): Promise<ChatMessage> {
  const resolvedArtifact = await resolveAssistantArtifact(response, artifactFetcher);

  return {
    id: createMessageId("assistant"),
    role: "assistant",
    content: response.text ?? "",
    artifact: resolvedArtifact.artifact,
    artifactError: resolvedArtifact.artifactError,
  };
}

function buildUserMessage(text: string, attachment: ChatAttachment | null): ChatMessage {
  return {
    id: createMessageId("user"),
    role: "user",
    content: text || attachment?.name || "Attachment",
    artifact: null,
    artifactError: null,
  };
}

function toUploadFile(attachment: ChatAttachment): ChatUploadFile {
  return {
    uri: attachment.uri,
    name: attachment.name,
    type: attachment.mimeType ?? undefined,
  };
}

export function useChatController({
  api,
  artifactFetcher,
  pickAttachment = pickSingleAttachment,
}: UseChatControllerOptions = {}): ChatController {
  const apiRef = useRef<ChatApiClient | null>(null);
  const artifactFetcherRef = useRef<ArtifactFetcher | null>(null);
  const pickAttachmentRef = useRef(pickAttachment);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draftText, setDraftText] = useState("");
  const [attachment, setAttachment] = useState<ChatAttachment | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  if (!apiRef.current) {
    apiRef.current = api ?? createDefaultApi();
  }

  if (!artifactFetcherRef.current) {
    artifactFetcherRef.current =
      artifactFetcher ?? createDefaultArtifactFetcher(apiRef.current);
  }

  pickAttachmentRef.current = pickAttachment;

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
    const trimmedDraft = draftText.trim();

    if (!trimmedDraft && !attachment) {
      return;
    }

    setIsSending(true);
    setError(null);

    try {
      const response = await apiRef.current!.sendMessage({
        text: trimmedDraft,
        files: attachment ? [toUploadFile(attachment)] : undefined,
      });
      const assistantMessage = await buildAssistantMessage(
        response,
        artifactFetcherRef.current!,
      );

      setMessages((current) => [
        ...current,
        buildUserMessage(trimmedDraft, attachment),
        assistantMessage,
      ]);
      setDraftText("");
      setAttachment(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to send message.");
    } finally {
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
    isLoadingHistory,
    isSending,
    error,
    pickAttachment: handlePickAttachment,
    clearAttachment: handleClearAttachment,
    sendMessage: handleSendMessage,
    clearHistory: handleClearHistory,
  };
}
