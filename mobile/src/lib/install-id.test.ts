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
  it("does not import Node crypto from the app module", () => {
    const source = readFileSync(join(__dirname, "install-id.ts"), "utf8");

    expect(source).not.toContain("node:crypto");
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

  it("hashes the install id deterministically", async () => {
    const firstHash = await hashInstallId("install-abc-123");
    const secondHash = await hashInstallId("install-abc-123");
    const thirdHash = await hashInstallId("install-other");

    expect(firstHash).toBe(secondHash);
    expect(firstHash).not.toBe(thirdHash);
    expect(firstHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
