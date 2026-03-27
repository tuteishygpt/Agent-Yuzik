import * as SecureStore from "expo-secure-store";

export const SUPABASE_SESSION_STORAGE_KEY = "yuzik.supabase.session";
export const INSTALL_ID_STORAGE_KEY = "yuzik.install_id";
export const AUTH_LINK_IN_PROGRESS_STORAGE_KEY = "yuzik.auth.link.pending";
const SECURE_STORE_CHUNK_SIZE = 1800;
const CHUNK_META_SUFFIX = ".meta";
const CHUNK_PART_SUFFIX = ".part";

export type SessionStorageAdapter = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

type ChunkMetadata = {
  chunkCount: number;
};

function getChunkMetadataKey(key: string): string {
  return `${key}${CHUNK_META_SUFFIX}`;
}

function getChunkPartKey(key: string, index: number): string {
  return `${key}${CHUNK_PART_SUFFIX}.${index}`;
}

function getChunkMetadata(value: string): ChunkMetadata | null {
  try {
    const parsedValue = JSON.parse(value) as Partial<ChunkMetadata>;

    if (typeof parsedValue.chunkCount !== "number" || parsedValue.chunkCount < 1) {
      return null;
    }

    return {
      chunkCount: parsedValue.chunkCount,
    };
  } catch {
    return null;
  }
}

async function removeChunkedValue(key: string): Promise<void> {
  const metadataKey = getChunkMetadataKey(key);
  const metadataValue = await SecureStore.getItemAsync(metadataKey);
  const metadata = metadataValue ? getChunkMetadata(metadataValue) : null;

  await SecureStore.deleteItemAsync(metadataKey);

  if (!metadata) {
    return;
  }

  await Promise.all(
    Array.from({ length: metadata.chunkCount }, (_, index) =>
      SecureStore.deleteItemAsync(getChunkPartKey(key, index)),
    ),
  );
}

export function createSecureSessionStorage(): SessionStorageAdapter {
  return {
    async getItem(key) {
      const inlineValue = await SecureStore.getItemAsync(key);
      const metadataValue = await SecureStore.getItemAsync(getChunkMetadataKey(key));

      if (!metadataValue) {
        return inlineValue;
      }

      const metadata = getChunkMetadata(metadataValue);

      if (!metadata) {
        return inlineValue;
      }

      const chunks = await Promise.all(
        Array.from({ length: metadata.chunkCount }, (_, index) =>
          SecureStore.getItemAsync(getChunkPartKey(key, index)),
        ),
      );

      if (chunks.some((chunk) => typeof chunk !== "string")) {
        return null;
      }

      return chunks.join("");
    },
    async setItem(key, value) {
      await removeChunkedValue(key);

      if (value.length <= SECURE_STORE_CHUNK_SIZE) {
        await SecureStore.setItemAsync(key, value);
        return;
      }

      await SecureStore.deleteItemAsync(key);

      const chunks = Array.from(
        { length: Math.ceil(value.length / SECURE_STORE_CHUNK_SIZE) },
        (_, index) =>
          value.slice(
            index * SECURE_STORE_CHUNK_SIZE,
            (index + 1) * SECURE_STORE_CHUNK_SIZE,
          ),
      );

      await SecureStore.setItemAsync(
        getChunkMetadataKey(key),
        JSON.stringify({ chunkCount: chunks.length }),
      );

      await Promise.all(
        chunks.map((chunk, index) =>
          SecureStore.setItemAsync(getChunkPartKey(key, index), chunk),
        ),
      );
    },
    async removeItem(key) {
      await SecureStore.deleteItemAsync(key);
      await removeChunkedValue(key);
    },
  };
}

export async function markAuthLinkInProgress(
  storage: SessionStorageAdapter = createSecureSessionStorage(),
): Promise<void> {
  await storage.setItem(AUTH_LINK_IN_PROGRESS_STORAGE_KEY, "1");
}

export async function clearAuthLinkInProgress(
  storage: SessionStorageAdapter = createSecureSessionStorage(),
): Promise<void> {
  await storage.removeItem(AUTH_LINK_IN_PROGRESS_STORAGE_KEY);
}

export async function isAuthLinkInProgress(
  storage: SessionStorageAdapter = createSecureSessionStorage(),
): Promise<boolean> {
  return (await storage.getItem(AUTH_LINK_IN_PROGRESS_STORAGE_KEY)) === "1";
}
