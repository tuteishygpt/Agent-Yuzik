export type AppVariant = "development" | "preview" | "production";

export type EnvSource = Record<string, string | undefined>;

export type PublicEnv = {
  backendUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  appScheme: string;
  buildChannel: string;
  debugMenuEnabled: boolean;
  debugNetworkLoggingEnabled: boolean;
};

type StaticPublicProcessEnv = {
  EXPO_PUBLIC_BACKEND_URL: string | undefined;
  EXPO_PUBLIC_SUPABASE_URL: string | undefined;
  EXPO_PUBLIC_SUPABASE_ANON_KEY: string | undefined;
  EXPO_PUBLIC_DEV_SCHEME: string | undefined;
  EXPO_PUBLIC_PROD_SCHEME: string | undefined;
  EXPO_PUBLIC_BUILD_CHANNEL: string | undefined;
  EXPO_PUBLIC_ENABLE_DEBUG_MENU: string | undefined;
  EXPO_PUBLIC_ENABLE_NETWORK_LOGGING: string | undefined;
  APP_VARIANT: string | undefined;
};

function readRequired(source: EnvSource, key: string): string {
  const value = source[key]?.trim();

  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }

  return value;
}

function normalizeUrl(value: string, key: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid URL in env var: ${key}`);
  }

  const pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");

  return `${url.origin}${pathname}`;
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();

  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

function sanitizeRuntimePublicEnv(source: Partial<PublicEnv>): PublicEnv {
  return {
    backendUrl: normalizeUrl(String(source.backendUrl ?? ""), "backendUrl"),
    supabaseUrl: normalizeUrl(String(source.supabaseUrl ?? ""), "supabaseUrl"),
    supabaseAnonKey: readRequired(
      { supabaseAnonKey: String(source.supabaseAnonKey ?? "") },
      "supabaseAnonKey",
    ),
    appScheme: readRequired(
      { appScheme: String(source.appScheme ?? "") },
      "appScheme",
    ),
    buildChannel: readRequired(
      { buildChannel: String(source.buildChannel ?? "") },
      "buildChannel",
    ),
    debugMenuEnabled: Boolean(source.debugMenuEnabled),
    debugNetworkLoggingEnabled: Boolean(source.debugNetworkLoggingEnabled),
  };
}

export function getAppVariant(source: EnvSource = process.env as EnvSource): AppVariant {
  const rawValue = source.APP_VARIANT?.trim().toLowerCase();

  if (rawValue === "preview" || rawValue === "production") {
    return rawValue;
  }

  return "development";
}

export function getAppPackageId(
  source: EnvSource = process.env as EnvSource,
): string {
  const variant = getAppVariant(source);

  if (variant === "production") {
    return readRequired(source, "APP_PROD_PACKAGE_ID");
  }

  if (variant === "preview") {
    return readRequired(source, "APP_PREVIEW_PACKAGE_ID");
  }

  return readRequired(source, "APP_DEV_PACKAGE_ID");
}

export function getPublicEnv(source: EnvSource = process.env as EnvSource): PublicEnv {
  const variant = getAppVariant(source);
  const backendUrl = normalizeUrl(
    readRequired(source, "EXPO_PUBLIC_BACKEND_URL"),
    "EXPO_PUBLIC_BACKEND_URL",
  );
  const supabaseUrl = normalizeUrl(
    readRequired(source, "EXPO_PUBLIC_SUPABASE_URL"),
    "EXPO_PUBLIC_SUPABASE_URL",
  );
  const supabaseAnonKey = readRequired(source, "EXPO_PUBLIC_SUPABASE_ANON_KEY");
  const devScheme = readRequired(source, "EXPO_PUBLIC_DEV_SCHEME");
  const prodScheme = readRequired(source, "EXPO_PUBLIC_PROD_SCHEME");
  const buildChannel = readRequired(source, "EXPO_PUBLIC_BUILD_CHANNEL");

  return {
    backendUrl,
    supabaseUrl,
    supabaseAnonKey,
    appScheme: variant === "production" ? prodScheme : devScheme,
    buildChannel,
    debugMenuEnabled: parseBoolean(source.EXPO_PUBLIC_ENABLE_DEBUG_MENU),
    debugNetworkLoggingEnabled: parseBoolean(
      source.EXPO_PUBLIC_ENABLE_NETWORK_LOGGING,
    ),
  };
}

function readStaticPublicProcessEnv(): StaticPublicProcessEnv {
  return {
    EXPO_PUBLIC_BACKEND_URL: process.env.EXPO_PUBLIC_BACKEND_URL,
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    EXPO_PUBLIC_DEV_SCHEME: process.env.EXPO_PUBLIC_DEV_SCHEME,
    EXPO_PUBLIC_PROD_SCHEME: process.env.EXPO_PUBLIC_PROD_SCHEME,
    EXPO_PUBLIC_BUILD_CHANNEL: process.env.EXPO_PUBLIC_BUILD_CHANNEL,
    EXPO_PUBLIC_ENABLE_DEBUG_MENU: process.env.EXPO_PUBLIC_ENABLE_DEBUG_MENU,
    EXPO_PUBLIC_ENABLE_NETWORK_LOGGING:
      process.env.EXPO_PUBLIC_ENABLE_NETWORK_LOGGING,
    APP_VARIANT: process.env.APP_VARIANT,
  };
}

export function getRuntimeEnv(): PublicEnv {
  try {
    const constantsModule = require("expo-constants");
    const constants = constantsModule.default ?? constantsModule;
    const runtimeEnv = constants?.expoConfig?.extra?.publicEnv as
      | Partial<PublicEnv>
      | undefined;

    if (runtimeEnv) {
      return sanitizeRuntimePublicEnv(runtimeEnv);
    }
  } catch {
    return getPublicEnv(readStaticPublicProcessEnv());
  }

  return getPublicEnv(readStaticPublicProcessEnv());
}

export function formatSecretState(value: string): string {
  return value.trim() ? "Configured" : "Missing";
}
