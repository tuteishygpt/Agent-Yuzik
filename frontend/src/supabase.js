import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

function requireEnv(name, value) {
  if (value && value.trim()) {
    return value.trim();
  }

  throw new Error(`Missing required Supabase environment variable: ${name}`);
}

export const supabase = createClient(
  requireEnv('VITE_SUPABASE_URL', supabaseUrl),
  requireEnv('VITE_SUPABASE_ANON_KEY', supabaseAnonKey),
  {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
      flowType: 'pkce',
    },
  }
);

let anonymousBootstrapPromise = null;

export async function getSupabaseSession() {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  return data.session ?? null;
}

export async function bootstrapAnonymousSession() {
  const existingSession = await getSupabaseSession();
  if (existingSession) {
    return existingSession;
  }

  if (!anonymousBootstrapPromise) {
    anonymousBootstrapPromise = (async () => {
      const { data, error } = await supabase.auth.signInAnonymously();
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

export async function getSupabaseUserId() {
  const session = await bootstrapAnonymousSession();
  return session?.user?.id ?? null;
}

export async function getSupabaseAccessToken() {
  const session = await bootstrapAnonymousSession();
  return session?.access_token ?? null;
}

export async function getSupabaseUser() {
  const session = await bootstrapAnonymousSession();
  return session?.user ?? null;
}

export function onSupabaseAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange(callback);
}

export async function linkAnonymousAccountWithEmail({ email, password }) {
  const redirectTo = `${window.location.origin}/auth/callback`;
  const { data, error } = await supabase.auth.updateUser(
    { email, password },
    { emailRedirectTo: redirectTo }
  );

  if (error) {
    throw error;
  }

  return data.user ?? null;
}
