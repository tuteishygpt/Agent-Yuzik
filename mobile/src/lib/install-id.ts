import * as Crypto from "expo-crypto";

import {
  INSTALL_ID_STORAGE_KEY,
  createSessionStorage,
  type SessionStorageAdapter,
} from "./session-storage";

type GetOrCreateInstallIdOptions = {
  storage?: SessionStorageAdapter;
  generateId?: () => Promise<string>;
};

function formatUuidV4(bytes: Uint8Array): string {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

function randomBytes16(): Uint8Array {
  const bytes = new Uint8Array(16);
  const webCrypto = globalThis.crypto;

  if (webCrypto?.getRandomValues) {
    webCrypto.getRandomValues(bytes);
    return bytes;
  }

  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }

  return bytes;
}

async function generateInstallId(): Promise<string> {
  try {
    return Crypto.randomUUID();
  } catch {
    return formatUuidV4(randomBytes16());
  }
}

export async function getOrCreateInstallId(
  options: GetOrCreateInstallIdOptions = {},
): Promise<string> {
  const storage = options.storage ?? createSessionStorage();
  const existingInstallId = await storage.getItem(INSTALL_ID_STORAGE_KEY);

  if (existingInstallId?.trim()) {
    return existingInstallId;
  }

  const nextInstallId = await (options.generateId ?? generateInstallId)();
  await storage.setItem(INSTALL_ID_STORAGE_KEY, nextInstallId);

  return nextInstallId;
}

export async function hashInstallId(installId: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    installId,
    {
      encoding: Crypto.CryptoEncoding.HEX,
    },
  );
}

export { INSTALL_ID_STORAGE_KEY };
