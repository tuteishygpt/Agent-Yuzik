jest.mock("expo-crypto", () => {
  const { createHash, randomUUID } = require("node:crypto") as typeof import("node:crypto");

  return {
    CryptoDigestAlgorithm: {
      SHA256: "SHA-256",
    },
    CryptoEncoding: {
      HEX: "hex",
    },
    digestStringAsync: async (_algorithm: string, value: string) =>
      createHash("sha256").update(value).digest("hex"),
    randomUUID,
  };
});
