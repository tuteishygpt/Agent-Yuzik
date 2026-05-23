import { Platform } from "react-native";

import { getOrCreateInstallId } from "./install-id";

export async function getLegacyMobileUserId(): Promise<string> {
  const platformPrefix = Platform.OS === "ios" ? "ios" : "and";
  const installId = await getOrCreateInstallId();

  return `mobile-user-${platformPrefix}-${installId.slice(0, 5)}`;
}
