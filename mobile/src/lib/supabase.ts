import "react-native-url-polyfill/auto";

import { createClient, type AuthChangeEvent, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";

import { getRuntimeEnv } from "./env";
import {
  AUTH_LINK_IN_PROGRESS_STORAGE_KEY,
  clearAuthLinkInProgress,
  createSecureSessionStorage,
  isAuthLinkInProgress,
  markAuthLinkInProgress,
} from "./session-storage";

let supabaseClient: SupabaseClient | null = null;
let anonymousBootstrapPromise: Promise<Session | null> | null = null;

function createSupabaseClient(): SupabaseClient {
  const env = getRuntimeEnv();

  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      persistSession: true,
      flowType: "pkce",
      storage: createSecureSessionStorage(),
    },
  });
}

export function getSupabase(): SupabaseClient {
  if (!supabaseClient) {
    supabaseClient = createSupabaseClient();
  }

  return supabaseClient;
}

export function getAuthRedirectUrl(scheme = getRuntimeEnv().appScheme): string {
  return `${scheme}://auth/callback`;
}

function getAuthCallbackRoute(url: URL): string {
  return `${url.host}${url.pathname}`.replace(/^\/+/, "");
}

function assertExpectedAuthCallbackUrl(url: string): URL {
  const parsedUrl = new URL(url);
  const callbackRoute = getAuthCallbackRoute(parsedUrl);

  if (callbackRoute !== "auth/callback") {
    throw new Error("Unexpected auth callback URL.");
  }

  return parsedUrl;
}

function getAuthCodeFromCallbackUrl(url: string): string {
  const parsedUrl = assertExpectedAuthCallbackUrl(url);
  const code = parsedUrl.searchParams.get("code")?.trim();

  if (!code) {
    throw new Error("Missing auth code in callback URL.");
  }

  return code;
}

export async function getSupabaseSession(): Promise<Session | null> {
  const { data, error } = await getSupabase().auth.getSession();

  if (error) {
    throw error;
  }

  return data.session ?? null;
}

export async function bootstrapAnonymousSession(): Promise<Session | null> {
  const existingSession = await getSupabaseSession();

  if (existingSession) {
    return existingSession;
  }

  if (!anonymousBootstrapPromise) {
    anonymousBootstrapPromise = (async () => {
      const { data, error } = await getSupabase().auth.signInAnonymously();

      if (error) {
        throw error;
      }

      return data.session ?? null;
    })().finally(() => {
      anonymousBootstrapPromise = null;
    });
  }

  return anonymousBootstrapPromise;
}

export function onSupabaseAuthStateChange(
  callback: (event: AuthChangeEvent, session: Session | null) => void,
) {
  return getSupabase().auth.onAuthStateChange(callback);
}

export function startSupabaseAutoRefresh(): void {
  getSupabase().auth.startAutoRefresh();
}

export function stopSupabaseAutoRefresh(): void {
  getSupabase().auth.stopAutoRefresh();
}

export async function completeSupabaseNativeCallback(url: string): Promise<Session | null> {
  if (!(await isAuthLinkInProgress())) {
    throw new Error("No email link flow is in progress.");
  }

  const authCode = getAuthCodeFromCallbackUrl(url);
  const { data, error } = await getSupabase().auth.exchangeCodeForSession(
    authCode,
  );

  if (error) {
    throw error;
  }

  if (!data.session) {
    throw new Error("Auth callback did not produce a session.");
  }

  await clearAuthLinkInProgress();

  return data.session;
}

export async function linkAnonymousAccountWithEmail(input: {
  email: string;
  password: string;
  scheme?: string;
}): Promise<User | null> {
  await markAuthLinkInProgress();

  try {
    const { data, error } = await getSupabase().auth.updateUser(
      {
        email: input.email,
        password: input.password,
      },
      {
        emailRedirectTo: getAuthRedirectUrl(input.scheme),
      },
    );

    if (error) {
      throw error;
    }

    return data.user ?? null;
  } catch (error) {
    await clearAuthLinkInProgress();
    throw error;
  }
}

export { AUTH_LINK_IN_PROGRESS_STORAGE_KEY };
