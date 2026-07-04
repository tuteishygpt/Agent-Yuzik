function createResponse<T>(body: T, init?: { ok?: boolean; status?: number }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("chat api", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("attaches the bearer token to history requests", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      createResponse({ history: [] }),
    );

    const { createChatApi } = require("./api") as typeof import("./api");
    const api = createChatApi({
      backendUrl: "https://api.yuzik.example",
      getAccessToken: async () => "token-123",
      fetchImpl,
    });

    await api.getHistory();

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.yuzik.example/api/chat/history",
      expect.objectContaining({
        method: "GET",
        headers: expect.any(Headers),
      }),
    );

    const headers = fetchImpl.mock.calls[0][1].headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer token-123");
  });

  it("allows chat requests without a bearer token for legacy web-compatible backends", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      createResponse({ text: "ok", audio: null, image: "/api/files/image-1" }),
    );

    const { createChatApi } = require("./api") as typeof import("./api");
    const api = createChatApi({
      backendUrl: "https://api.yuzik.example",
      getAccessToken: async () => null,
      fetchImpl,
    });

    await expect(api.sendMessage({ text: "hello" })).resolves.toEqual({
      text: "ok",
      audio: null,
      image: "/api/files/image-1",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.yuzik.example/api/chat",
      expect.objectContaining({
        method: "POST",
        headers: expect.any(Headers),
      }),
    );

    const headers = fetchImpl.mock.calls[0][1].headers as Headers;
    expect(headers.get("Authorization")).toBeNull();
  });

  it("includes the legacy mobile user id in chat multipart requests", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      createResponse({ text: "ok", audio: null, image: null }),
    );
    const appendSpy = jest.spyOn(FormData.prototype, "append");

    const { createChatApi } = require("./api") as typeof import("./api");
    const api = createChatApi({
      backendUrl: "https://api.yuzik.example",
      getAccessToken: async () => null,
      getLegacyUserId: async () => "mobile-user-and-abc12",
      fetchImpl,
    });

    try {
      await api.sendMessage({ text: "hello" });

      expect(appendSpy).toHaveBeenCalledWith("text", "hello");
      expect(appendSpy).toHaveBeenCalledWith("user_id", "mobile-user-and-abc12");
    } finally {
      appendSpy.mockRestore();
    }
  });

  it("includes the legacy mobile user id in history requests", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      createResponse({ history: [] }),
    );

    const { createChatApi } = require("./api") as typeof import("./api");
    const api = createChatApi({
      backendUrl: "https://api.yuzik.example",
      getAccessToken: async () => null,
      getLegacyUserId: async () => "mobile-user-ios-def34",
      fetchImpl,
    });

    await api.getHistory();
    await api.clearHistory();

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://api.yuzik.example/api/chat/history?user_id=mobile-user-ios-def34",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://api.yuzik.example/api/chat/history?user_id=mobile-user-ios-def34",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("serializes a single attachment as multipart form data", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      createResponse({ text: "ok", audio: null, image: null }),
    );
    const appendSpy = jest.spyOn(FormData.prototype, "append");

    const { createChatApi } = require("./api") as typeof import("./api");
    const api = createChatApi({
      backendUrl: "https://api.yuzik.example",
      getAccessToken: async () => "token-123",
      fetchImpl,
    });

    try {
      await api.sendMessage({
        text: "hello",
        files: [
          {
            uri: "file:///tmp/diagram.png",
            name: "diagram.png",
            type: "image/png",
          },
        ],
      });

      expect(appendSpy).toHaveBeenCalledWith("text", "hello");
      expect(appendSpy).toHaveBeenCalledWith(
        "files",
        expect.objectContaining({
          uri: "file:///tmp/diagram.png",
          name: "diagram.png",
          type: "image/png",
        }),
      );
    } finally {
      appendSpy.mockRestore();
    }
  });

  it("serializes browser blob attachments as real multipart files on web", async () => {
    const { Platform } = require("react-native") as typeof import("react-native");
    const originalPlatform = Platform.OS;
    const fetchImpl = jest.fn().mockResolvedValue(
      createResponse({ text: "ok", audio: null, image: null }),
    );
    const appendSpy = jest.spyOn(FormData.prototype, "append");
    const voiceBlob = new Blob(["RIFF"], { type: "audio/wav" });

    Object.defineProperty(Platform, "OS", {
      configurable: true,
      value: "web",
    });

    try {
      const { createChatApi } = require("./api") as typeof import("./api");
      const api = createChatApi({
        backendUrl: "https://api.yuzik.example",
        getAccessToken: async () => "token-123",
        fetchImpl,
      });

      await api.sendMessage({
        text: "",
        files: [
          {
            uri: "blob:yuzik-voice-message",
            name: "voice-message.wav",
            type: "audio/wav",
            blob: voiceBlob,
          },
        ],
      });

      expect(appendSpy).toHaveBeenCalledWith("text", "");
      expect(appendSpy).toHaveBeenCalledWith(
        "files",
        voiceBlob,
        "voice-message.wav",
      );
    } finally {
      appendSpy.mockRestore();
      Object.defineProperty(Platform, "OS", {
        configurable: true,
        value: originalPlatform,
      });
    }
  });

  it("rejects multi-file uploads at the client boundary", async () => {
    const fetchImpl = jest.fn();

    const { createChatApi } = require("./api") as typeof import("./api");
    const api = createChatApi({
      backendUrl: "https://api.yuzik.example",
      getAccessToken: async () => "token-123",
      fetchImpl,
    });

    await expect(
      api.sendMessage({
        text: "hello",
        files: [
          {
            uri: "file:///tmp/one.png",
            name: "one.png",
            type: "image/png",
          },
          {
            uri: "file:///tmp/two.png",
            name: "two.png",
            type: "image/png",
          },
        ],
      }),
    ).rejects.toThrow("Only one attachment is supported.");

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("surfaces backend validation errors as-is", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      createResponse(
        {
          detail: "File must be PDF, TXT, or audio.",
        },
        {
          ok: false,
          status: 422,
        },
      ),
    );

    const { createChatApi } = require("./api") as typeof import("./api");
    const api = createChatApi({
      backendUrl: "https://api.yuzik.example",
      getAccessToken: async () => "token-123",
      fetchImpl,
    });

    await expect(
      api.sendMessage({
        text: "hello",
        files: [
          {
            uri: "file:///tmp/report.exe",
            name: "report.exe",
            type: "application/octet-stream",
          },
        ],
      }),
    ).rejects.toThrow("File must be PDF, TXT, or audio.");
  });

  it("preserves structured backend validation errors instead of rewriting them", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      createResponse(
        {
          detail: [
            {
              loc: ["body", "files", 0],
              msg: "Invalid file type.",
            },
          ],
        },
        {
          ok: false,
          status: 422,
        },
      ),
    );

    const { createChatApi } = require("./api") as typeof import("./api");
    const api = createChatApi({
      backendUrl: "https://api.yuzik.example",
      getAccessToken: async () => "token-123",
      fetchImpl,
    });

    await expect(
      api.sendMessage({
        text: "hello",
      }),
    ).rejects.toThrow('[{"loc":["body","files",0],"msg":"Invalid file type."}]');
  });

  it("creates an authenticated /api/files request through the typed client", async () => {
    const { createChatApi } = require("./api") as typeof import("./api");
    const api = createChatApi({
      backendUrl: "https://api.yuzik.example",
      getAccessToken: async () => "token-123",
      fetchImpl: jest.fn(),
    });

    await expect(api.createArtifactRequest("artifact-1")).resolves.toEqual({
      url: "https://api.yuzik.example/api/files/artifact-1",
      headers: {
        Authorization: "Bearer token-123",
      },
    });
  });

  it("creates an unauthenticated /api/files request when no token is available", async () => {
    const { createChatApi } = require("./api") as typeof import("./api");
    const api = createChatApi({
      backendUrl: "https://api.yuzik.example",
      getAccessToken: async () => null,
      fetchImpl: jest.fn(),
    });

    await expect(api.createArtifactRequest("artifact-1")).resolves.toEqual({
      url: "https://api.yuzik.example/api/files/artifact-1",
      headers: {},
    });
  });
});

describe("artifact fetcher", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("downloads protected artifacts once and reuses the cached local uri", async () => {
    const downloadAsync = jest.fn().mockResolvedValue({
      uri: "file:///cache/yuzik-artifact-abc123.png",
    });
    const getInfoAsync = jest.fn().mockResolvedValue({ exists: false });
    const makeDirectoryAsync = jest.fn().mockResolvedValue(undefined);
    const openUrl = jest.fn().mockResolvedValue(undefined);

    const { createArtifactFetcher } = require("./artifact-fetch") as typeof import("./artifact-fetch");
    const fetcher = createArtifactFetcher({
      api: {
        createArtifactRequest: async (artifactId: string) => ({
          url: `https://api.yuzik.example/api/files/${artifactId}`,
          headers: {
            Authorization: "Bearer token-123",
          },
        }),
      },
      fileSystem: {
        cacheDirectory: "file:///cache/",
        downloadAsync,
        getInfoAsync,
        makeDirectoryAsync,
      },
      sharing: {
        isAvailableAsync: async () => true,
        shareAsync: jest.fn().mockResolvedValue(undefined),
      },
      openUrl,
    });

    const first = await fetcher.resolveArtifact({
      artifactId: "abc123",
      mimeType: "image/png",
      filename: "diagram.png",
    });
    const second = await fetcher.resolveArtifact({
      artifactId: "abc123",
      mimeType: "image/png",
      filename: "diagram.png",
    });

    expect(first.localUri).toBe("file:///cache/yuzik-artifact-abc123.png");
    expect(second.localUri).toBe("file:///cache/yuzik-artifact-abc123.png");
    expect(downloadAsync).toHaveBeenCalledTimes(1);
    expect(downloadAsync).toHaveBeenCalledWith(
      "https://api.yuzik.example/api/files/abc123",
      "file:///cache/yuzik-artifacts/abc123.png",
      {
        headers: {
          Authorization: "Bearer token-123",
        },
      },
    );
    expect(getInfoAsync).toHaveBeenCalledWith(
      "file:///cache/yuzik-artifacts/abc123.png",
    );
    expect(first.presentation).toBe("preview");
    expect(second.presentation).toBe("preview");
  });

  it("marks non-preview artifacts for system handling", async () => {
    const downloadAsync = jest.fn().mockResolvedValue({
      uri: "file:///cache/yuzik-artifact-def456.pdf",
    });

    const { createArtifactFetcher } = require("./artifact-fetch") as typeof import("./artifact-fetch");
    const fetcher = createArtifactFetcher({
      api: {
        createArtifactRequest: async (artifactId: string) => ({
          url: `https://api.yuzik.example/api/files/${artifactId}`,
          headers: {
            Authorization: "Bearer token-123",
          },
        }),
      },
      fileSystem: {
        cacheDirectory: "file:///cache/",
        downloadAsync,
        getInfoAsync: jest.fn().mockResolvedValue({ exists: false }),
        makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
      },
      sharing: {
        isAvailableAsync: async () => true,
        shareAsync: jest.fn().mockResolvedValue(undefined),
      },
      openUrl: jest.fn().mockResolvedValue(undefined),
    });

    const artifact = await fetcher.resolveArtifact({
      artifactId: "def456",
      mimeType: "application/pdf",
      filename: "report.pdf",
    });

    expect(artifact.presentation).toBe("system");
    expect(artifact.localUri).toBe("file:///cache/yuzik-artifact-def456.pdf");
  });

  it("downloads signed artifact urls directly without creating an api file request", async () => {
    const downloadAsync = jest.fn().mockResolvedValue({
      uri: "file:///cache/yuzik-artifact-url123.png",
    });
    const createArtifactRequest = jest.fn();
    const signedUrl = "https://storage.example/object/sign/file.png?token=abc";

    const { createArtifactFetcher } = require("./artifact-fetch") as typeof import("./artifact-fetch");
    const fetcher = createArtifactFetcher({
      api: {
        createArtifactRequest,
      },
      fileSystem: {
        cacheDirectory: "file:///cache/",
        downloadAsync,
        getInfoAsync: jest.fn().mockResolvedValue({ exists: false }),
        makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
      },
      sharing: {
        isAvailableAsync: async () => true,
        shareAsync: jest.fn().mockResolvedValue(undefined),
      },
      openUrl: jest.fn().mockResolvedValue(undefined),
    });

    const artifact = await fetcher.resolveArtifact({
      artifactId: "url123",
      sourceUrl: signedUrl,
      mimeType: "image/png",
      filename: "signed.png",
    });

    expect(createArtifactRequest).not.toHaveBeenCalled();
    expect(downloadAsync).toHaveBeenCalledWith(
      signedUrl,
      "file:///cache/yuzik-artifacts/url123.png",
      {
        headers: {},
      },
    );
    expect(artifact.presentation).toBe("preview");
    expect(artifact.localUri).toBe("file:///cache/yuzik-artifact-url123.png");
  });

  it("uses a browser blob url for preview artifacts when web file cache is unavailable", async () => {
    const { Platform } = require("react-native") as typeof import("react-native");
    const originalPlatform = Platform.OS;
    const originalCreateObjectUrl = URL.createObjectURL;
    const createObjectURL = jest.fn(() => "blob:yuzik-image");
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      blob: jest.fn().mockResolvedValue(new Blob(["image"], { type: "image/png" })),
    });
    const downloadAsync = jest.fn();
    const getInfoAsync = jest.fn();
    const makeDirectoryAsync = jest.fn();

    Object.defineProperty(Platform, "OS", {
      configurable: true,
      value: "web",
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });

    try {
      const { createArtifactFetcher } = require("./artifact-fetch") as typeof import("./artifact-fetch");
      const fetcher = createArtifactFetcher({
        api: {
          createArtifactRequest: async (artifactId: string) => ({
            url: `https://api.yuzik.example/api/files/${artifactId}`,
            headers: {
              Authorization: "Bearer token-123",
            },
          }),
        },
        fetchImpl,
        fileSystem: {
          cacheDirectory: null,
          downloadAsync,
          getInfoAsync,
          makeDirectoryAsync,
        },
        sharing: {
          isAvailableAsync: async () => false,
          shareAsync: jest.fn(),
        },
        openUrl: jest.fn(),
      });

      const artifact = await fetcher.resolveArtifact({
        artifactId: "image-1",
        mimeType: "image/png",
        filename: "image-1.png",
      });
      const cachedArtifact = await fetcher.resolveArtifact({
        artifactId: "image-1",
        mimeType: "image/png",
        filename: "image-1.png",
      });

      expect(artifact.localUri).toBe("blob:yuzik-image");
      expect(cachedArtifact.localUri).toBe("blob:yuzik-image");
      expect(artifact.presentation).toBe("preview");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(fetchImpl).toHaveBeenCalledWith(
        "https://api.yuzik.example/api/files/image-1",
        {
          headers: {
            Authorization: "Bearer token-123",
          },
        },
      );
      expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      expect(downloadAsync).not.toHaveBeenCalled();
      expect(getInfoAsync).not.toHaveBeenCalled();
      expect(makeDirectoryAsync).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(Platform, "OS", {
        configurable: true,
        value: originalPlatform,
      });
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: originalCreateObjectUrl,
      });
    }
  });

  it("uses the cache key for local storage while preserving the remote artifact id", async () => {
    const downloadAsync = jest.fn().mockResolvedValue({
      uri: "file:///cache/yuzik-artifact-response-1.wav",
    });
    const createArtifactRequest = jest.fn(async (artifactId: string) => ({
      url: `https://api.yuzik.example/api/files/${artifactId}`,
      headers: {},
    }));

    const { createArtifactFetcher } = require("./artifact-fetch") as typeof import("./artifact-fetch");
    const fetcher = createArtifactFetcher({
      api: {
        createArtifactRequest,
      },
      fileSystem: {
        cacheDirectory: "file:///cache/",
        downloadAsync,
        getInfoAsync: jest.fn().mockResolvedValue({ exists: false }),
        makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
      },
      sharing: {
        isAvailableAsync: async () => true,
        shareAsync: jest.fn().mockResolvedValue(undefined),
      },
      openUrl: jest.fn().mockResolvedValue(undefined),
    });

    await fetcher.resolveArtifact({
      artifactId: "tts_output.wav",
      cacheKey: "assistant-response-1-tts_output.wav",
      mimeType: "audio/*",
      filename: "tts_output.wav",
    });

    expect(createArtifactRequest).toHaveBeenCalledWith("tts_output.wav");
    expect(downloadAsync).toHaveBeenCalledWith(
      "https://api.yuzik.example/api/files/tts_output.wav",
      "file:///cache/yuzik-artifacts/assistant-response-1-tts_output.wav",
      {
        headers: {},
      },
    );
  });
});
