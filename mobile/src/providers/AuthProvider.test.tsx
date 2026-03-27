import React from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

import CallbackScreen from "../../app/auth/callback";

import { AuthProvider, useAuth } from "./AuthProvider";
import {
  SUPABASE_SESSION_STORAGE_KEY,
  createSecureSessionStorage,
} from "@/lib/session-storage";

const mockReplace = jest.fn();
const mockRouter = {
  replace: mockReplace,
};
const mockUseURL = jest.fn<string | null, []>();
const mockSetItemAsync = jest.fn<Promise<void>, [string, string]>();
const mockGetItemAsync = jest.fn<Promise<string | null>, [string]>();
const mockDeleteItemAsync = jest.fn<Promise<void>, [string]>();
const mockRegisterCurrentDevice = jest.fn<Promise<void>, [unknown]>();
const mockSyncProfileBootstrap = jest.fn<Promise<void>, [unknown]>();
const secureStoreValues = new Map<string, string>();

jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
}));

jest.mock("expo-linking", () => ({
  useURL: () => mockUseURL(),
}));

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      version: "9.9.9",
    },
  },
}));

jest.mock("expo-secure-store", () => ({
  setItemAsync: (...args: [string, string]) => mockSetItemAsync(...args),
  getItemAsync: (...args: [string]) => mockGetItemAsync(...args),
  deleteItemAsync: (...args: [string]) => mockDeleteItemAsync(...args),
}));

jest.mock("@/lib/env", () => ({
  getRuntimeEnv: () => ({
    backendUrl: "https://api.yuzik.example",
    supabaseUrl: "https://project.supabase.co",
    supabaseAnonKey: "anon-key",
    appScheme: "yuzik-dev",
    buildChannel: "development",
    debugMenuEnabled: false,
    debugNetworkLoggingEnabled: false,
  }),
}));

jest.mock("@/lib/device-registration", () => ({
  registerCurrentDevice: (...args: [unknown]) => mockRegisterCurrentDevice(...args),
}));

jest.mock("@/lib/profile-sync", () => ({
  syncProfileBootstrap: (...args: [unknown]) => mockSyncProfileBootstrap(...args),
}));

type SessionLike = {
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
    email?: string;
    is_anonymous?: boolean;
  };
};

let currentSession: SessionLike | null = null;
const authStateCallbacks = new Set<(event: string, session: SessionLike | null) => void>();
const mockSignInAnonymously = jest.fn<Promise<{ data: { session: SessionLike }; error: null }>, []>();
const mockGetSession = jest.fn<Promise<{ data: { session: SessionLike | null }; error: null }>, []>();
const mockOnAuthStateChange = jest.fn();
const mockUpdateUser = jest.fn();
const mockCompleteSupabaseNativeCallback = jest.fn();
const mockStartAutoRefresh = jest.fn();
const mockStopAutoRefresh = jest.fn();

jest.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    auth: {
      getSession: () => mockGetSession(),
      signInAnonymously: () => mockSignInAnonymously(),
      onAuthStateChange: (...args: [(_event: string, _session: SessionLike | null) => void]) =>
        mockOnAuthStateChange(...args),
      updateUser: (...args: [unknown, unknown]) => mockUpdateUser(...args),
    },
  }),
  getSupabaseSession: () => mockGetSession().then((result) => result.data.session),
  bootstrapAnonymousSession: async () => {
    const result = await mockSignInAnonymously();
    return result.data.session;
  },
  onSupabaseAuthStateChange: (...args: [(_event: string, _session: SessionLike | null) => void]) =>
    mockOnAuthStateChange(...args),
  startSupabaseAutoRefresh: () => mockStartAutoRefresh(),
  stopSupabaseAutoRefresh: () => mockStopAutoRefresh(),
  linkAnonymousAccountWithEmail: async ({
    email,
    password,
    scheme,
  }: {
    email: string;
    password: string;
    scheme?: string;
  }) => {
    const result = await mockUpdateUser(
      {
        email,
        password,
      },
      {
        emailRedirectTo: `${scheme ?? "yuzik-dev"}://auth/callback`,
      },
    );

    return result.data.user;
  },
  completeSupabaseNativeCallback: (...args: [string]) =>
    mockCompleteSupabaseNativeCallback(...args),
  getAuthRedirectUrl: (scheme?: string) => `${scheme ?? "yuzik-dev"}://auth/callback`,
  parseSupabaseCallbackUrl: (url: string) => {
    const parsed = new URL(url.replace("#", "?"));
    return {
      accessToken: parsed.searchParams.get("access_token"),
      refreshToken: parsed.searchParams.get("refresh_token"),
    };
  },
}));

function Probe() {
  const auth = useAuth();
  const label = auth.session?.user?.is_anonymous ? "guest" : "email";

  return <Text>{`${auth.status}:${auth.userId ?? "none"}:${label}`}</Text>;
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function createSession(
  userId: string,
  options?: {
    email?: string;
    isAnonymous?: boolean;
  },
): SessionLike {
  return {
    access_token: `access-${userId}`,
    refresh_token: `refresh-${userId}`,
    user: {
      id: userId,
      email: options?.email,
      is_anonymous: options?.isAnonymous ?? false,
    },
  };
}

beforeEach(() => {
  currentSession = null;
  authStateCallbacks.clear();
  secureStoreValues.clear();

  mockReplace.mockReset();
  mockUseURL.mockReset();
  mockSetItemAsync.mockReset().mockImplementation(async (key, value) => {
    secureStoreValues.set(key, value);
  });
  mockGetItemAsync.mockReset().mockImplementation(async (key) => {
    return secureStoreValues.get(key) ?? null;
  });
  mockDeleteItemAsync.mockReset().mockImplementation(async (key) => {
    secureStoreValues.delete(key);
  });
  mockRegisterCurrentDevice.mockReset().mockResolvedValue(undefined);
  mockSyncProfileBootstrap.mockReset().mockResolvedValue(undefined);
  mockStartAutoRefresh.mockReset();
  mockStopAutoRefresh.mockReset();
  mockCompleteSupabaseNativeCallback.mockReset().mockResolvedValue(
    createSession("email-user", {
      email: "listener@yuzik.dev",
      isAnonymous: false,
    }),
  );

  mockGetSession.mockReset().mockImplementation(async () => ({
    data: { session: currentSession },
    error: null,
  }));

  mockSignInAnonymously.mockReset().mockImplementation(async () => {
    currentSession = createSession("guest-user", { isAnonymous: true });

    for (const callback of authStateCallbacks) {
      callback("SIGNED_IN", currentSession);
    }

    return {
      data: { session: currentSession },
      error: null,
    };
  });

  mockOnAuthStateChange.mockReset().mockImplementation(
    (callback: (event: string, session: SessionLike | null) => void) => {
      authStateCallbacks.add(callback);

      return {
        data: {
          subscription: {
            unsubscribe() {
              authStateCallbacks.delete(callback);
            },
          },
        },
      };
    },
  );

  mockUpdateUser.mockReset().mockResolvedValue({
    data: {
      user: {
        id: "guest-user",
        email: "listener@yuzik.dev",
      },
    },
    error: null,
  });

});

describe("secure session storage", () => {
  it("persists and restores the Supabase session payload", async () => {
    const storage = createSecureSessionStorage();
    const serializedSession = JSON.stringify({
      access_token: "access-1",
      refresh_token: "refresh-1",
      user: { id: "guest-user" },
    });

    mockGetItemAsync.mockResolvedValue(serializedSession);

    await storage.setItem(SUPABASE_SESSION_STORAGE_KEY, serializedSession);

    expect(mockSetItemAsync).toHaveBeenCalledWith(
      SUPABASE_SESSION_STORAGE_KEY,
      serializedSession,
    );
    expect(await storage.getItem(SUPABASE_SESSION_STORAGE_KEY)).toBe(
      serializedSession,
    );

    await storage.removeItem(SUPABASE_SESSION_STORAGE_KEY);

    expect(mockDeleteItemAsync).toHaveBeenCalledWith(
      SUPABASE_SESSION_STORAGE_KEY,
    );
  });

  it("persists and restores large session payloads across multiple secure-store items", async () => {
    const storage = createSecureSessionStorage();
    const largeSerializedSession = JSON.stringify({
      access_token: "access-large",
      refresh_token: "refresh-large",
      user: {
        id: "guest-user",
      },
      identities: Array.from({ length: 200 }, (_, index) => ({
        id: `identity-${index}`,
        provider: "email",
        token: "x".repeat(80),
      })),
    });

    await storage.setItem(SUPABASE_SESSION_STORAGE_KEY, largeSerializedSession);

    expect(mockSetItemAsync.mock.calls.length).toBeGreaterThan(1);
    expect(await storage.getItem(SUPABASE_SESSION_STORAGE_KEY)).toBe(
      largeSerializedSession,
    );

    await storage.removeItem(SUPABASE_SESSION_STORAGE_KEY);

    expect(await storage.getItem(SUPABASE_SESSION_STORAGE_KEY)).toBeNull();
  });
});

describe("AuthProvider", () => {
  it("reuses the same anonymous session across app restarts", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        <AuthProvider>
          <Probe />
        </AuthProvider>,
      );
    });

    await flushAsyncWork();

    expect(mockSignInAnonymously).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByType(Text).props.children).toBe(
      "ready:guest-user:guest",
    );
    expect(mockRegisterCurrentDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        appVersion: "9.9.9",
      }),
    );

    act(() => {
      renderer.unmount();
    });

    await act(async () => {
      renderer = TestRenderer.create(
        <AuthProvider>
          <Probe />
        </AuthProvider>,
      );
    });

    await flushAsyncWork();

    expect(mockSignInAnonymously).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByType(Text).props.children).toBe(
      "ready:guest-user:guest",
    );
  });

  it("starts guest to email linking with the callback route redirect", async () => {
    let observedAuth:
      | ReturnType<typeof useAuth>
      | undefined;

    function LinkProbe() {
      observedAuth = useAuth();
      return <Text>{observedAuth.status}</Text>;
    }

    await act(async () => {
      TestRenderer.create(
        <AuthProvider>
          <LinkProbe />
        </AuthProvider>,
      );
    });

    await flushAsyncWork();

    await act(async () => {
      await observedAuth?.linkWithEmail({
        email: "listener@yuzik.dev",
        password: "password-123",
      });
    });

    expect(mockUpdateUser).toHaveBeenCalledWith(
      {
        email: "listener@yuzik.dev",
        password: "password-123",
      },
      {
        emailRedirectTo: "yuzik-dev://auth/callback",
      },
    );
  });
});

describe("auth callback route", () => {
  function getTextContent(renderer: TestRenderer.ReactTestRenderer): string {
    return renderer.root
      .findAllByType(Text)
      .map((node) => String(node.props.children ?? ""))
      .join(" ");
  }

  it.each([
    "yuzik-dev://auth/callback?code=pkce-dev",
    "yuzik://auth/callback?code=pkce-prod",
  ])("exchanges a PKCE code and returns to the app shell for %s", async (url) => {
    mockUseURL.mockReturnValue(url);

    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<CallbackScreen />);
    });

    await flushAsyncWork();

    expect(getTextContent(renderer)).toContain("Completing sign in");
    expect(mockCompleteSupabaseNativeCallback).toHaveBeenCalledWith(url);
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)");

    act(() => {
      renderer.unmount();
    });
  });

  it("stays on the callback screen with an error state when completion fails", async () => {
    mockUseURL.mockReturnValue("yuzik-dev://auth/callback?code=bad-code");
    mockCompleteSupabaseNativeCallback.mockRejectedValue(
      new Error("Auth callback could not be verified."),
    );

    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(<CallbackScreen />);
    });

    await flushAsyncWork();

    expect(mockReplace).not.toHaveBeenCalled();
    expect(getTextContent(renderer)).toContain("Sign in couldn't be completed");
    expect(getTextContent(renderer)).toContain(
      "Auth callback could not be verified.",
    );

    act(() => {
      renderer.unmount();
    });
  });
});

describe("supabase pkce callback completion", () => {
  async function loadRealSupabaseModule() {
    jest.resetModules();

    const secureValues = new Map<string, string>();
    const exchangeCodeForSession = jest.fn().mockResolvedValue({
      data: {
        session: createSession("email-user", {
          email: "listener@yuzik.dev",
          isAnonymous: false,
        }),
      },
      error: null,
    });
    const updateUser = jest.fn().mockResolvedValue({
      data: {
        user: {
          id: "guest-user",
          email: "listener@yuzik.dev",
        },
      },
      error: null,
    });

    jest.doMock("expo-secure-store", () => ({
      setItemAsync: async (key: string, value: string) => {
        secureValues.set(key, value);
      },
      getItemAsync: async (key: string) => secureValues.get(key) ?? null,
      deleteItemAsync: async (key: string) => {
        secureValues.delete(key);
      },
    }));

    jest.doMock("@/lib/env", () => ({
      getRuntimeEnv: () => ({
        backendUrl: "https://api.yuzik.example",
        supabaseUrl: "https://project.supabase.co",
        supabaseAnonKey: "anon-key",
        appScheme: "yuzik-dev",
        buildChannel: "development",
        debugMenuEnabled: false,
        debugNetworkLoggingEnabled: false,
      }),
    }));

    jest.doMock("@supabase/supabase-js", () => ({
      createClient: () => ({
        auth: {
          exchangeCodeForSession,
          getSession: async () => ({ data: { session: null }, error: null }),
          onAuthStateChange: jest.fn(),
          signInAnonymously: jest.fn(),
          startAutoRefresh: jest.fn(),
          stopAutoRefresh: jest.fn(),
          updateUser,
        },
      }),
    }));

    jest.unmock("@/lib/supabase");

    let supabaseModule!: typeof import("@/lib/supabase");

    jest.isolateModules(() => {
      supabaseModule = require("@/lib/supabase") as typeof import("@/lib/supabase");
    });

    return {
      secureValues,
      exchangeCodeForSession,
      updateUser,
      supabaseModule,
    };
  }

  afterEach(() => {
    jest.resetModules();
  });

  it("exchanges the auth code for a session only when a link flow is pending", async () => {
    const { supabaseModule, exchangeCodeForSession, updateUser, secureValues } =
      await loadRealSupabaseModule();

    await supabaseModule.linkAnonymousAccountWithEmail({
      email: "listener@yuzik.dev",
      password: "password-123",
      scheme: "yuzik-dev",
    });

    expect(updateUser).toHaveBeenCalledWith(
      {
        email: "listener@yuzik.dev",
        password: "password-123",
      },
      {
        emailRedirectTo: "yuzik-dev://auth/callback",
      },
    );

    await supabaseModule.completeSupabaseNativeCallback(
      "yuzik-dev://auth/callback?code=pkce-code",
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith("pkce-code");
    expect(
      secureValues.get(supabaseModule.AUTH_LINK_IN_PROGRESS_STORAGE_KEY),
    ).toBeUndefined();
  });

  it("rejects callback completion when no link flow is pending", async () => {
    const { supabaseModule, exchangeCodeForSession } = await loadRealSupabaseModule();

    await expect(
      supabaseModule.completeSupabaseNativeCallback(
        "yuzik-dev://auth/callback?code=pkce-code",
      ),
    ).rejects.toThrow("No email link flow is in progress.");

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("rejects malformed callback urls without exchanging a code", async () => {
    const { supabaseModule, exchangeCodeForSession } = await loadRealSupabaseModule();

    await supabaseModule.linkAnonymousAccountWithEmail({
      email: "listener@yuzik.dev",
      password: "password-123",
      scheme: "yuzik-dev",
    });

    await expect(
      supabaseModule.completeSupabaseNativeCallback(
        "yuzik-dev://malicious/path?code=pkce-code",
      ),
    ).rejects.toThrow("Unexpected auth callback URL.");

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("throws a deterministic error when the code exchange returns no session and no error", async () => {
    const { supabaseModule, exchangeCodeForSession } = await loadRealSupabaseModule();

    exchangeCodeForSession.mockResolvedValueOnce({
      data: {
        session: null,
      },
      error: null,
    });

    await supabaseModule.linkAnonymousAccountWithEmail({
      email: "listener@yuzik.dev",
      password: "password-123",
      scheme: "yuzik-dev",
    });

    await expect(
      supabaseModule.completeSupabaseNativeCallback(
        "yuzik-dev://auth/callback?code=pkce-code",
      ),
    ).rejects.toThrow("Auth callback did not produce a session.");
  });
});
