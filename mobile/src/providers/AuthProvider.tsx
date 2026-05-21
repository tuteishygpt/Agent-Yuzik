import React, { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Constants from "expo-constants";
import { AppState, Platform } from "react-native";
import type { Session } from "@supabase/supabase-js";

import { registerCurrentDevice } from "@/lib/device-registration";
import { getRuntimeEnv } from "@/lib/env";
import { syncProfileBootstrap } from "@/lib/profile-sync";
import {
  bootstrapAnonymousSession,
  getSupabase,
  getSupabaseSession,
  linkAnonymousAccountWithEmail,
  onSupabaseAuthStateChange,
  startSupabaseAutoRefresh,
  stopSupabaseAutoRefresh,
} from "@/lib/supabase";

type AuthStatus = "loading" | "ready" | "error";

type LinkWithEmailInput = {
  email: string;
  password: string;
};

type AuthContextValue = {
  status: AuthStatus;
  session: Session | null;
  userId: string | null;
  isAnonymous: boolean;
  error: Error | null;
  linkWithEmail: (input: LinkWithEmailInput) => Promise<void>;
};

const defaultAuthContextValue: AuthContextValue = {
  status: "ready",
  session: null,
  userId: null,
  isAnonymous: false,
  error: null,
  async linkWithEmail() {
    throw new Error("AuthProvider is not mounted");
  },
};

const AuthContext = createContext<AuthContextValue>(defaultAuthContextValue);

function getSessionUserId(session: Session | null): string | null {
  return session?.user?.id ?? null;
}

function getSessionIsAnonymous(session: Session | null): boolean {
  return Boolean(session?.user?.is_anonymous);
}

function getAppVersion(): string {
  const version = String(Constants.expoConfig?.version ?? "").trim();

  return version || "1.0.0";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const authSubscription = onSupabaseAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setStatus("ready");
      setError(null);
    });

    let isMounted = true;

    void (async () => {
      try {
        const existingSession = await getSupabaseSession();
        const nextSession = existingSession ?? (await bootstrapAnonymousSession());

        if (!isMounted) {
          return;
        }

        setSession(nextSession);
        setStatus("ready");
      } catch (nextError) {
        if (!isMounted) {
          return;
        }

        setError(nextError as Error);
        setStatus("error");
      }
    })();

    return () => {
      isMounted = false;
      authSubscription.data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    startSupabaseAutoRefresh();

    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        startSupabaseAutoRefresh();
        void getSupabaseSession().then((refreshed) => {
          if (refreshed) {
            setSession(refreshed);
          }
        });
        return;
      }

      stopSupabaseAutoRefresh();
    });

    return () => {
      appStateSubscription.remove();
      stopSupabaseAutoRefresh();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      return;
    }

    void (async () => {
      const params = {
        supabase: getSupabase(),
        session,
        appVersion: getAppVersion(),
        platform: Platform.OS,
      };
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await registerCurrentDevice(params);
          return;
        } catch {
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          }
        }
      }
    })();

    void syncProfileBootstrap({
      supabase: getSupabase(),
      session,
    });
  }, [session]);

  const value: AuthContextValue = {
    status,
    session,
    userId: getSessionUserId(session),
    isAnonymous: getSessionIsAnonymous(session),
    error,
    async linkWithEmail(input) {
      await linkAnonymousAccountWithEmail({
        ...input,
        scheme: getRuntimeEnv().appScheme,
      });
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
