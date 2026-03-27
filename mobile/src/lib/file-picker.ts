export type ChatAttachment = {
  uri: string;
  name: string;
  mimeType: string | null;
};

function normalizeAttachment(
  asset: {
    uri: string;
    name?: string | null;
    mimeType?: string | null;
  },
): ChatAttachment {
  return {
    uri: asset.uri,
    name: asset.name?.trim() || "attachment",
    mimeType: asset.mimeType ?? null,
  };
}

export async function pickSingleAttachment(): Promise<ChatAttachment | null> {
  const picker = require("expo-document-picker") as {
    getDocumentAsync: (options?: {
      type?: string | string[];
      copyToCacheDirectory?: boolean;
      multiple?: boolean;
    }) => Promise<{
      canceled: boolean;
      assets: Array<{
        uri: string;
        name?: string | null;
        mimeType?: string | null;
      }> | null;
    }>;
  };

  const result = await picker.getDocumentAsync({
    type: ["image/*", "audio/*", "application/pdf", "text/plain"],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled || !result.assets?.length) {
    return null;
  }

  return normalizeAttachment(result.assets[0]);
}

export { normalizeAttachment };
