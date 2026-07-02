import {
  INSTALL_ID_STORAGE_KEY,
  getOrCreateInstallId,
  hashInstallId,
} from "./install-id";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type MemoryStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
  values: Map<string, string>;
};

function createMemoryStorage(): MemoryStorage {
  const values = new Map<string, string>();

  return {
    values,
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    async removeItem(key) {
      values.delete(key);
    },
  };
}

describe("install id", () => {
  const originalCrypto = global.crypto;

  afterEach(() => {
    jest.restoreAllMocks();
    jest.dontMock("expo-crypto");
    Object.defineProperty(global, "crypto", {
      configurable: true,
      value: originalCrypto,
    });
  });

  it("does not import Node crypto from the app module", () => {
    const source = readFileSync(join(__dirname, "install-id.ts"), "utf8");

    expect(source).not.toContain("node:crypto");
  });

  it("keeps a web crypto fallback for runtimes without randomUUID", () => {
    const source = readFileSync(join(__dirname, "install-id.ts"), "utf8");

    expect(source).toContain("getRandomValues");
  });

  it("generates an install id once and reuses it on later reads", async () => {
    const storage = createMemoryStorage();
    const generateId = jest.fn<Promise<string>, []>().mockResolvedValue(
      "install-abc-123",
    );

    const firstInstallId = await getOrCreateInstallId({ storage, generateId });
    const secondInstallId = await getOrCreateInstallId({ storage, generateId });

    expect(firstInstallId).toBe("install-abc-123");
    expect(secondInstallId).toBe("install-abc-123");
    expect(generateId).toHaveBeenCalledTimes(1);
    expect(storage.values.get(INSTALL_ID_STORAGE_KEY)).toBe("install-abc-123");
  });

  it("generates an install id when expo randomUUID is unavailable on web", async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock("expo-crypto", () => ({
        __esModule: true,
        randomUUID: jest.fn(() => {
          throw new TypeError("getCrypto(...).randomUUID is not a function");
        }),
        digestStringAsync: jest.fn(),
        CryptoDigestAlgorithm: { SHA256: "SHA-256" },
        CryptoEncoding: { HEX: "hex" },
      }));

      const { getOrCreateInstallId: getOrCreateInstallIdWithFallback } =
        require("./install-id") as typeof import("./install-id");
      const storage = createMemoryStorage();
      Object.defineProperty(global, "crypto", {
        configurable: true,
        value: {
          getRandomValues(bytes: Uint8Array) {
            for (let i = 0; i < bytes.length; i++) {
              bytes[i] = i + 1;
            }
            return bytes;
          },
        },
      });

      const installId = await getOrCreateInstallIdWithFallback({ storage });

      expect(installId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(storage.values.get(INSTALL_ID_STORAGE_KEY)).toBe(installId);
    });
  });

  it("hashes the install id deterministically", async () => {
    const firstHash = await hashInstallId("install-abc-123");
    const secondHash = await hashInstallId("install-abc-123");
    const thirdHash = await hashInstallId("install-other");

    expect(firstHash).toBe(secondHash);
    expect(firstHash).not.toBe(thirdHash);
    expect(firstHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
