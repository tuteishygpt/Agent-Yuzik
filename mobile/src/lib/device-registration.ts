import { getOrCreateInstallId, hashInstallId as hashInstallIdValue } from "./install-id";
import type { AuthSessionLike } from "./profile-sync";

type UpsertResult = {
  error: Error | null;
};

type SupabaseUpsertClient = {
  from: (table: string) => {
    upsert: (
      payload: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => PromiseLike<UpsertResult> | UpsertResult;
  };
};

type RegisterCurrentDeviceOptions = {
  supabase: SupabaseUpsertClient;
  session: AuthSessionLike | null;
  appVersion: string;
  platform: string;
  getInstallId?: () => Promise<string>;
  hashInstallId?: (installId: string) => Promise<string>;
};

export async function registerCurrentDevice({
  supabase,
  session,
  appVersion,
  platform,
  getInstallId = getOrCreateInstallId,
  hashInstallId = hashInstallIdValue,
}: RegisterCurrentDeviceOptions): Promise<void> {
  const userId = session?.user.id?.trim();

  if (!userId) {
    return;
  }

  const installId = await getInstallId();
  const installIdHash = await hashInstallId(installId);
  const { error } = await supabase.from("devices").upsert(
    {
      user_id: userId,
      install_id_hash: installIdHash,
      app_version: appVersion,
      platform,
      last_seen_at: new Date().toISOString(),
    },
    {
      onConflict: "user_id,install_id_hash",
    },
  );

  if (error) {
    throw error;
  }
}
