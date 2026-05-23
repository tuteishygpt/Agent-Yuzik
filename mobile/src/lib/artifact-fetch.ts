import { Linking } from "react-native";

import type { ArtifactRequest, ChatApiClient } from "@/lib/api";

export type ArtifactPresentation = "preview" | "system";

export type ResolvedArtifact = {
  localUri: string;
  presentation: ArtifactPresentation;
  openInSystem: () => Promise<void>;
  share: () => Promise<void>;
};

export type FileSystemLike = {
  cacheDirectory: string | null;
  getInfoAsync: (fileUri: string) => Promise<{ exists: boolean }>;
  downloadAsync: (
    uri: string,
    fileUri: string,
    options?: { headers?: Record<string, string> },
  ) => Promise<{ uri: string }>;
  makeDirectoryAsync: (
    fileUri: string,
    options?: { intermediates?: boolean },
  ) => Promise<void>;
};

export type SharingLike = {
  isAvailableAsync: () => Promise<boolean>;
  shareAsync: (
    url: string,
    options?: { mimeType?: string; dialogTitle?: string },
  ) => Promise<void>;
};

export type ArtifactFetcher = {
  resolveArtifact: (input: {
    artifactId?: string | null;
    cacheKey?: string | null;
    sourceUrl?: string | null;
    mimeType?: string | null;
    filename?: string | null;
  }) => Promise<ResolvedArtifact>;
};

type ArtifactFetcherOptions = {
  api: Pick<ChatApiClient, "createArtifactRequest">;
  fileSystem?: FileSystemLike;
  sharing?: SharingLike;
  openUrl?: (url: string) => Promise<void>;
};

const artifactCache = new Map<string, string>();

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
}

function getExtension(filename: string | null | undefined): string {
  if (!filename) {
    return "";
  }

  const match = /\.([a-z0-9]+)$/i.exec(filename);

  return match ? `.${match[1].toLowerCase()}` : "";
}

function getFallbackExtension(mimeType: string | null | undefined): string {
  const normalized = (mimeType ?? "").toLowerCase();

  if (normalized.startsWith("image/")) {
    const subtype = normalized.split("/")[1];
    return `.${subtype && subtype !== "*" ? subtype : "png"}`;
  }

  if (normalized.startsWith("audio/")) {
    const subtype = normalized.split("/")[1];
    return `.${subtype && subtype !== "*" ? subtype : "mp3"}`;
  }

  if (normalized === "application/pdf") {
    return ".pdf";
  }

  if (normalized === "text/plain") {
    return ".txt";
  }

  return ".bin";
}

function isInlinePreview(mimeType: string | null | undefined): boolean {
  const normalized = (mimeType ?? "").toLowerCase();
  return normalized.startsWith("image/") || normalized.startsWith("audio/");
}

function buildArtifactCachePath(
  cacheDirectory: string | null,
  artifactId: string,
  mimeType?: string | null,
  filename?: string | null,
): string {
  if (!cacheDirectory) {
    throw new Error("File system cache directory is unavailable.");
  }

  const directory = cacheDirectory.endsWith("/")
    ? cacheDirectory
    : `${cacheDirectory}/`;
  const safeArtifactId = sanitizeSegment(artifactId);
  const extension = /\.[a-z0-9]+$/i.test(safeArtifactId)
    ? ""
    : getExtension(filename) || getFallbackExtension(mimeType);

  return `${directory}yuzik-artifacts/${safeArtifactId}${extension}`;
}

async function getDefaultFileSystem(): Promise<FileSystemLike> {
  const fileSystem = require("expo-file-system/legacy") as FileSystemLike;

  return fileSystem;
}

async function getDefaultSharing(): Promise<SharingLike> {
  const sharing = require("expo-sharing") as SharingLike;

  return sharing;
}

export function createArtifactFetcher({
  api,
  fileSystem,
  sharing,
  openUrl = async (url: string) => {
    await Linking.openURL(url);
  },
}: ArtifactFetcherOptions): ArtifactFetcher {
  let fileSystemPromise: Promise<FileSystemLike> | null = null;
  let sharingPromise: Promise<SharingLike> | null = null;

  async function resolveFileSystem(): Promise<FileSystemLike> {
    if (fileSystem) {
      return fileSystem;
    }

    fileSystemPromise ??= getDefaultFileSystem();
    return fileSystemPromise;
  }

  async function resolveSharing(): Promise<SharingLike> {
    if (sharing) {
      return sharing;
    }

    sharingPromise ??= getDefaultSharing();
    return sharingPromise;
  }

  async function ensureLocalArtifact(
    artifactId: string,
    cacheKey?: string | null,
    mimeType?: string | null,
    filename?: string | null,
    sourceUrl?: string | null,
  ): Promise<string> {
    const fs = await resolveFileSystem();
    const cacheUri = buildArtifactCachePath(
      fs.cacheDirectory,
      cacheKey || artifactId,
      mimeType,
      filename,
    );

    const cached = artifactCache.get(cacheUri);
    if (cached) {
      return cached;
    }

    const info = await fs.getInfoAsync(cacheUri);
    if (!info.exists) {
      await fs.makeDirectoryAsync(cacheUri.replace(/\/[^/]+$/, ""), {
        intermediates: true,
      });

      const request: ArtifactRequest = sourceUrl
        ? { url: sourceUrl, headers: {} }
        : await api.createArtifactRequest(artifactId);

      const downloadResult = await fs.downloadAsync(
        request.url,
        cacheUri,
        {
          headers: request.headers,
        },
      );

      artifactCache.set(cacheUri, downloadResult.uri ?? cacheUri);
      return downloadResult.uri ?? cacheUri;
    }

    artifactCache.set(cacheUri, cacheUri);
    return cacheUri;
  }

  async function openArtifactInSystem(
    localUri: string,
    mimeType?: string | null,
    filename?: string | null,
  ): Promise<void> {
    const share = await resolveSharing();

    if (await share.isAvailableAsync()) {
      await share.shareAsync(localUri, {
        mimeType: mimeType ?? undefined,
        dialogTitle: filename ?? "Attachment",
      });
      return;
    }

    await openUrl(localUri);
  }

  return {
    async resolveArtifact({ artifactId, cacheKey, sourceUrl, mimeType, filename }) {
      if (!artifactId) {
        throw new Error("Assistant artifact ID could not be resolved.");
      }

      const localUri = await ensureLocalArtifact(
        artifactId,
        cacheKey,
        mimeType,
        filename,
        sourceUrl,
      );

      return {
        localUri,
        presentation: isInlinePreview(mimeType) ? "preview" : "system",
        openInSystem: async () => {
          await openArtifactInSystem(localUri, mimeType, filename);
        },
        share: async () => {
          await openArtifactInSystem(localUri, mimeType, filename);
        },
      };
    },
  };
}
