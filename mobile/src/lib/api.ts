import { getRuntimeEnv } from "./env";

export type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatUploadFile = {
  uri: string;
  name: string;
  type?: string | null;
};

export type ChatResponse = {
  text: string | null;
  audio: string | null;
  image: string | null;
};

export type ArtifactRequest = {
  url: string;
  headers: Record<string, string>;
};

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export type ChatApiClient = {
  getHistory: () => Promise<ChatHistoryMessage[]>;
  clearHistory: () => Promise<void>;
  createArtifactRequest: (artifactId: string) => Promise<ArtifactRequest>;
  sendMessage: (input: {
    text: string;
    files?: ChatUploadFile[];
  }) => Promise<ChatResponse>;
};

type ChatApiClientOptions = {
  backendUrl: string;
  getAccessToken: () => Promise<string | null>;
  getLegacyUserId?: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
};

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function withLegacyUserId(path: string, legacyUserId: string | null): string {
  const normalizedUserId = legacyUserId?.trim();

  if (!normalizedUserId) {
    return path;
  }

  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}user_id=${encodeURIComponent(normalizedUserId)}`;
}

function createHeaders(accessToken: string | null, headers?: HeadersInit): Headers {
  const nextHeaders = new Headers(headers);

  if (accessToken) {
    nextHeaders.set("Authorization", `Bearer ${accessToken}`);
  }

  return nextHeaders;
}

function isNetworkLoggingEnabled(): boolean {
  try {
    return getRuntimeEnv().debugNetworkLoggingEnabled;
  } catch {
    return false;
  }
}

function getBodySummary(body: BodyInit | null | undefined): string {
  if (!body) {
    return "none";
  }

  if (typeof FormData !== "undefined" && body instanceof FormData) {
    return "form-data";
  }

  if (typeof body === "string") {
    return `string:${body.length}B`;
  }

  return "present";
}

function logNetwork(message: string, metadata?: Record<string, unknown>): void {
  if (!isNetworkLoggingEnabled()) {
    return;
  }

  if (metadata) {
    console.log(`[Network] ${message}`, metadata);
    return;
  }

  console.log(`[Network] ${message}`);
}

async function readBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  try {
    return await response.text();
  } catch {
    return null;
  }
}

function getErrorMessage(body: unknown, fallback: string): string {
  if (typeof body === "string" && body.trim()) {
    return body.trim();
  }

  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;

    if (typeof record.detail === "string" && record.detail.trim()) {
      return record.detail.trim();
    }

    if ("detail" in record && record.detail != null) {
      try {
        return JSON.stringify(record.detail);
      } catch {
        return fallback;
      }
    }

    if (typeof record.message === "string" && record.message.trim()) {
      return record.message.trim();
    }
  }

  return fallback;
}

async function requestJson<T>(
  backendUrl: string,
  fetchImpl: typeof fetch,
  getAccessToken: () => Promise<string | null>,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const accessToken = await getAccessToken();

  const url = joinUrl(backendUrl, path);
  const method = init?.method ?? "GET";
  const startedAt = Date.now();

  logNetwork("HTTP request", {
    method,
    url,
    hasAuthToken: Boolean(accessToken),
    body: getBodySummary(init?.body),
  });

  const response = await fetchImpl(url, {
    ...init,
    headers: createHeaders(accessToken, init?.headers),
  });

  const body = await readBody(response);
  const durationMs = Date.now() - startedAt;

  logNetwork("HTTP response", {
    method,
    url,
    status: response.status,
    ok: response.ok,
    durationMs,
  });

  if (!response.ok) {
    logNetwork("HTTP error body", {
      method,
      url,
      status: response.status,
      body,
    });

    throw new ApiError(
      getErrorMessage(body, `Request failed with status ${response.status}.`),
      response.status,
      body,
    );
  }

  return body as T;
}

function createMultipartBody(
  text: string,
  files: ChatUploadFile[] | undefined,
  legacyUserId?: string | null,
): FormData {
  if ((files?.length ?? 0) > 1) {
    throw new ApiError("Only one attachment is supported.", 400, null);
  }

  const body = new FormData();
  body.append("text", text);

  const normalizedUserId = legacyUserId?.trim();
  if (normalizedUserId) {
    body.append("user_id", normalizedUserId);
  }

  for (const file of files ?? []) {
    body.append(
      "files",
      {
        uri: file.uri,
        name: file.name,
        type: file.type ?? "application/octet-stream",
      } as never,
    );
  }

  return body;
}

export function createChatApiClient({
  backendUrl,
  getAccessToken,
  getLegacyUserId,
  fetchImpl = fetch,
}: ChatApiClientOptions): ChatApiClient {
  return {
    async getHistory() {
      const legacyUserId = (await getLegacyUserId?.()) ?? null;
      const payload = await requestJson<{ history?: ChatHistoryMessage[] }>(
        backendUrl,
        fetchImpl,
        getAccessToken,
        withLegacyUserId("/api/chat/history", legacyUserId),
        {
          method: "GET",
        },
      );

      return payload.history ?? [];
    },
    async clearHistory() {
      const legacyUserId = (await getLegacyUserId?.()) ?? null;
      await requestJson<{ status?: string }>(
        backendUrl,
        fetchImpl,
        getAccessToken,
        withLegacyUserId("/api/chat/history", legacyUserId),
        {
          method: "DELETE",
        },
      );
    },
    async createArtifactRequest(artifactId: string) {
      const accessToken = await getAccessToken();
      const headers: Record<string, string> = accessToken
        ? { Authorization: `Bearer ${accessToken}` }
        : {};

      return {
        url: joinUrl(backendUrl, `/api/files/${artifactId}`),
        headers,
      };
    },
    async sendMessage({ text, files }) {
      const legacyUserId = (await getLegacyUserId?.()) ?? null;
      const payload = await requestJson<ChatResponse>(
        backendUrl,
        fetchImpl,
        getAccessToken,
        "/api/chat",
        {
          method: "POST",
          body: createMultipartBody(text, files, legacyUserId),
        },
      );

      logNetwork("Chat response payload", {
        text: payload.text ?? null,
        audio: payload.audio ?? null,
        image: payload.image ?? null,
      });

      return {
        text: payload.text ?? null,
        audio: payload.audio ?? null,
        image: payload.image ?? null,
      };
    },
  };
}

export function createChatApi(options: ChatApiClientOptions): ChatApiClient {
  return createChatApiClient(options);
}
