import type { ConfigContext, ExpoConfig } from "@expo/config";

import { getAppPackageId, getAppVariant, getPublicEnv } from "./src/lib/env";

export default ({ config }: ConfigContext): ExpoConfig => {
  const env = process.env;
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
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    plugins: ["expo-router"],
    experiments: {
      typedRoutes: true,
    },
    ios: {
      bundleIdentifier: packageId,
    },
    android: {
      package: packageId,
    },
    extra: {
      buildProfile: env.EAS_BUILD_PROFILE?.trim() || variant,
      publicEnv,
    },
  };
};
