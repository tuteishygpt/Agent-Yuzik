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
  fetchImpl?: typeof fetch;
};

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function createHeaders(accessToken: string | null, headers?: HeadersInit): Headers {
  const nextHeaders = new Headers(headers);

  if (accessToken) {
    nextHeaders.set("Authorization", `Bearer ${accessToken}`);
  }

  return nextHeaders;
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

  if (!accessToken) {
    throw new ApiError("Missing Supabase access token.", 401, null);
  }

  const response = await fetchImpl(joinUrl(backendUrl, path), {
    ...init,
    headers: createHeaders(accessToken, init?.headers),
  });

  const body = await readBody(response);

  if (!response.ok) {
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
): FormData {
  if ((files?.length ?? 0) > 1) {
    throw new ApiError("Only one attachment is supported.", 400, null);
  }

  const body = new FormData();
  body.append("text", text);

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
  fetchImpl = fetch,
}: ChatApiClientOptions): ChatApiClient {
  return {
    async getHistory() {
      const payload = await requestJson<{ history?: ChatHistoryMessage[] }>(
        backendUrl,
        fetchImpl,
        getAccessToken,
        "/api/chat/history",
        {
          method: "GET",
        },
      );

      return payload.history ?? [];
    },
    async clearHistory() {
      await requestJson<{ status?: string }>(
        backendUrl,
        fetchImpl,
        getAccessToken,
        "/api/chat/history",
        {
          method: "DELETE",
        },
      );
    },
    async createArtifactRequest(artifactId: string) {
      const accessToken = await getAccessToken();

      if (!accessToken) {
        throw new ApiError("Missing Supabase access token.", 401, null);
      }

      return {
        url: joinUrl(backendUrl, `/api/files/${artifactId}`),
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      };
    },
    async sendMessage({ text, files }) {
      const payload = await requestJson<ChatResponse>(
        backendUrl,
        fetchImpl,
        getAccessToken,
        "/api/chat",
        {
          method: "POST",
          body: createMultipartBody(text, files),
        },
      );

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
