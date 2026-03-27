export type AuthSessionLike = {
  user: {
    id: string;
    email?: string | null;
    is_anonymous?: boolean;
  };
};

export type ProfileState = {
  onboarding: {
    status: "anonymous" | "linked";
  };
};

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

type SyncProfileBootstrapOptions = {
  supabase: SupabaseUpsertClient;
  session: AuthSessionLike | null;
};

function createProfileState(session: AuthSessionLike): ProfileState {
  return {
    onboarding: {
      status: session.user.is_anonymous ? "anonymous" : "linked",
    },
  };
}

export async function syncProfileBootstrap({
  supabase,
  session,
}: SyncProfileBootstrapOptions): Promise<void> {
  const nextSession = session;
  const userId = nextSession?.user.id?.trim();

  if (!nextSession || !userId) {
    return;
  }

  const { error } = await supabase.from("profiles").upsert(
    {
      user_id: userId,
      onboarding_state: nextSession.user.is_anonymous ? "anonymous" : "linked",
      profile_state: createProfileState(nextSession),
    },
    {
      onConflict: "user_id",
    },
  );

  if (error) {
    throw error;
  }
}
