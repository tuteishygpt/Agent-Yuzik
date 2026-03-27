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
});
