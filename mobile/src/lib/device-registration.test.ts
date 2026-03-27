import { registerCurrentDevice } from "./device-registration";
import { syncProfileBootstrap } from "./profile-sync";

type SessionLike = {
  user: {
    id: string;
    is_anonymous?: boolean;
  };
};

type UpsertCall = {
  table: string;
  payload: Record<string, unknown>;
  options: Record<string, unknown> | undefined;
};

function createSupabaseRecorder() {
  const upserts: UpsertCall[] = [];

  return {
    upserts,
    from(table: string) {
      return {
        async upsert(
          payload: Record<string, unknown>,
          options?: Record<string, unknown>,
        ) {
          upserts.push({ table, payload, options });
          return { error: null };
        },
      };
    },
  };
}

function createSession(id: string, isAnonymous = true): SessionLike {
  return {
    user: {
      id,
      is_anonymous: isAnonymous,
    },
  };
}

describe("device registration", () => {
  it("hashes the install id and upserts it into public.devices", async () => {
    const supabase = createSupabaseRecorder();
    const getInstallId = jest.fn<Promise<string>, []>().mockResolvedValue(
      "install-abc-123",
    );
    const hashInstallId = jest
      .fn<Promise<string>, [string]>()
      .mockResolvedValue("hash-install-abc-123");

    await registerCurrentDevice({
      supabase,
      session: createSession("guest-user"),
      appVersion: "1.2.3",
      platform: "ios",
      getInstallId,
      hashInstallId,
    });

    expect(getInstallId).toHaveBeenCalledTimes(1);
    expect(hashInstallId).toHaveBeenCalledWith("install-abc-123");
    expect(supabase.upserts).toEqual([
      {
        table: "devices",
        payload: expect.objectContaining({
          user_id: "guest-user",
          install_id_hash: "hash-install-abc-123",
          app_version: "1.2.3",
          platform: "ios",
        }),
        options: expect.objectContaining({
          onConflict: "user_id,install_id_hash",
        }),
      },
    ]);
  });

  it("keeps public.devices upserts unique within each user_id", async () => {
    const supabase = createSupabaseRecorder();

    await registerCurrentDevice({
      supabase,
      session: createSession("guest-user"),
      appVersion: "1.2.3",
      platform: "ios",
      getInstallId: async () => "install-abc-123",
      hashInstallId: async () => "hash-install-abc-123",
    });

    await registerCurrentDevice({
      supabase,
      session: createSession("email-user", false),
      appVersion: "1.2.3",
      platform: "ios",
      getInstallId: async () => "install-abc-123",
      hashInstallId: async () => "hash-install-abc-123",
    });

    expect(supabase.upserts).toHaveLength(2);
    expect(supabase.upserts[0]).toMatchObject({
      table: "devices",
      payload: expect.objectContaining({ user_id: "guest-user" }),
      options: expect.objectContaining({ onConflict: "user_id,install_id_hash" }),
    });
    expect(supabase.upserts[1]).toMatchObject({
      table: "devices",
      payload: expect.objectContaining({ user_id: "email-user" }),
      options: expect.objectContaining({ onConflict: "user_id,install_id_hash" }),
    });
  });
});

describe("profile bootstrap", () => {
  it("upserts a single public.profiles row per user_id", async () => {
    const supabase = createSupabaseRecorder();

    await syncProfileBootstrap({
      supabase,
      session: createSession("guest-user"),
    });

    await syncProfileBootstrap({
      supabase,
      session: createSession("guest-user"),
    });

    expect(supabase.upserts).toEqual([
      {
        table: "profiles",
        payload: expect.objectContaining({
          user_id: "guest-user",
          profile_state: {
            onboarding: {
              status: "anonymous",
            },
          },
        }),
        options: expect.objectContaining({ onConflict: "user_id" }),
      },
      {
        table: "profiles",
        payload: expect.objectContaining({
          user_id: "guest-user",
          profile_state: {
            onboarding: {
              status: "anonymous",
            },
          },
        }),
        options: expect.objectContaining({ onConflict: "user_id" }),
      },
    ]);
  });

  it("does not migrate guest-owned rows when linking switches to a new user id", async () => {
    const supabase = createSupabaseRecorder();

    await syncProfileBootstrap({
      supabase,
      session: createSession("guest-user"),
    });

    await syncProfileBootstrap({
      supabase,
      session: createSession("email-user", false),
    });

    expect(supabase.upserts).toEqual([
      {
        table: "profiles",
        payload: expect.objectContaining({
          user_id: "guest-user",
          profile_state: {
            onboarding: {
              status: "anonymous",
            },
          },
        }),
        options: expect.objectContaining({ onConflict: "user_id" }),
      },
      {
        table: "profiles",
        payload: expect.objectContaining({
          user_id: "email-user",
          profile_state: {
            onboarding: {
              status: "linked",
            },
          },
        }),
        options: expect.objectContaining({ onConflict: "user_id" }),
      },
    ]);
  });
});
