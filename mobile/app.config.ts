import type { ConfigContext, ExpoConfig } from "@expo/config";
import { loadProjectEnv } from "@expo/env";

loadProjectEnv(__dirname, { silent: true });

type EnvSource = Record<string, string | undefined>;

type ExpoConfigWithLegacyArchitecture = ExpoConfig & {
  newArchEnabled: boolean;
  android: NonNullable<ExpoConfig["android"]> & {
    newArchEnabled: boolean;
  };
  ios: NonNullable<ExpoConfig["ios"]> & {
    newArchEnabled: boolean;
  };
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

function getAppVariant(source: EnvSource): "development" | "preview" | "production" {
  const rawValue = source.APP_VARIANT?.trim().toLowerCase();

  if (rawValue === "preview" || rawValue === "production") {
    return rawValue;
  }

  return "development";
}

function getAppPackageId(source: EnvSource): string {
  const variant = getAppVariant(source);

  if (variant === "production") {
    return readRequired(source, "APP_PROD_PACKAGE_ID");
  }

  if (variant === "preview") {
    return readRequired(source, "APP_PREVIEW_PACKAGE_ID");
  }

  return readRequired(source, "APP_DEV_PACKAGE_ID");
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

function getPublicEnv(source: EnvSource) {
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

export default ({ config }: ConfigContext): ExpoConfigWithLegacyArchitecture => {
  const env = process.env as EnvSource;
  const variant = getAppVariant(env);
  const publicEnv = getPublicEnv(env);
  const version = env.APP_VERSION?.trim() || config.version || "1.0.0";
  const packageId = getAppPackageId(env);

  return {
    ...config,
    name:
      variant === "production"
        ? "Yuzik"
        : variant === "preview"
          ? "Yuzik Preview"
          : "Yuzik Dev",
    slug: "yuzik-mobile",
    version,
    scheme: publicEnv.appScheme,
    newArchEnabled: false,
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    plugins: ["expo-router", "expo-secure-store", "expo-asset"],
    experiments: {
      typedRoutes: true,
    },
    ios: {
      bundleIdentifier: packageId,
      newArchEnabled: false,
    },
    android: {
      package: packageId,
      newArchEnabled: false,
      permissions: ["INTERNET", "MODIFY_AUDIO_SETTINGS", "RECORD_AUDIO", "VIBRATE"],
    },
    extra: {
      buildProfile: env.EAS_BUILD_PROFILE?.trim() || variant,
      publicEnv,
      eas: {
        projectId: "0493fa6f-9900-40ca-bf62-a171d31ecb3f",
      },
    },
  };
};
