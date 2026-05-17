import * as Crypto from "expo-crypto";

import {
  INSTALL_ID_STORAGE_KEY,
  createSecureSessionStorage,
  type SessionStorageAdapter,
} from "./session-storage";

type GetOrCreateInstallIdOptions = {
  storage?: SessionStorageAdapter;
  generateId?: () => Promise<string>;
};

async function generateInstallId(): Promise<string> {
  return Crypto.randomUUID();
}

export async function getOrCreateInstallId(
  options: GetOrCreateInstallIdOptions = {},
): Promise<string> {
  const storage = options.storage ?? createSecureSessionStorage();
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
