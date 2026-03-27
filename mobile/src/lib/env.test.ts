import { getAppPackageId, getPublicEnv } from "./env";

describe("getPublicEnv", () => {
  const baseEnv = {
    EXPO_PUBLIC_BACKEND_URL: "https://api.yuzik.example/",
    EXPO_PUBLIC_SUPABASE_URL: "https://project.supabase.co/",
    EXPO_PUBLIC_SUPABASE_ANON_KEY: "anon-secret-key",
    EXPO_PUBLIC_DEV_SCHEME: "yuzik-dev",
    EXPO_PUBLIC_PROD_SCHEME: "yuzik",
    EXPO_PUBLIC_BUILD_CHANNEL: "preview",
    APP_DEV_PACKAGE_ID: "com.yuzik.mobile.dev",
    APP_PREVIEW_PACKAGE_ID: "com.yuzik.mobile.preview",
    APP_PROD_PACKAGE_ID: "com.yuzik.mobile",
  };

  it("parses backend and supabase values and selects the development scheme by default", () => {
    expect(
      getPublicEnv({
        ...baseEnv,
        APP_VARIANT: "development",
      }),
    ).toEqual({
      backendUrl: "https://api.yuzik.example",
      supabaseUrl: "https://project.supabase.co",
      supabaseAnonKey: "anon-secret-key",
      appScheme: "yuzik-dev",
      buildChannel: "preview",
      debugMenuEnabled: false,
      debugNetworkLoggingEnabled: false,
    });
  });

  it("switches to the production app scheme for production builds", () => {
    expect(
      getPublicEnv({
        ...baseEnv,
        APP_VARIANT: "production",
      }).appScheme,
    ).toBe("yuzik");
  });

  it("honors optional debug toggles", () => {
    expect(
      getPublicEnv({
        ...baseEnv,
        EXPO_PUBLIC_ENABLE_DEBUG_MENU: "true",
        EXPO_PUBLIC_ENABLE_NETWORK_LOGGING: "1",
      }),
    ).toMatchObject({
      debugMenuEnabled: true,
      debugNetworkLoggingEnabled: true,
    });
  });

  it("selects a dedicated preview package id", () => {
    expect(
      getAppPackageId({
        ...baseEnv,
        APP_VARIANT: "preview",
      }),
    ).toBe("com.yuzik.mobile.preview");
  });

  it("falls back to statically-read public env when expo config is unavailable", () => {
    jest.resetModules();
    jest.doMock("expo-constants", () => ({
      __esModule: true,
      default: {
        expoConfig: undefined,
      },
    }));

    const previousEnv = { ...process.env };

    process.env.EXPO_PUBLIC_BACKEND_URL = "https://fallback-api.yuzik.example/";
    process.env.EXPO_PUBLIC_SUPABASE_URL =
      "https://fallback-project.supabase.co/";
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = "fallback-anon-key";
    process.env.EXPO_PUBLIC_DEV_SCHEME = "yuzik-dev-fallback";
    process.env.EXPO_PUBLIC_PROD_SCHEME = "yuzik-fallback";
    process.env.EXPO_PUBLIC_BUILD_CHANNEL = "runtime-fallback";
    process.env.EXPO_PUBLIC_ENABLE_DEBUG_MENU = "true";
    process.env.EXPO_PUBLIC_ENABLE_NETWORK_LOGGING = "false";
    process.env.APP_VARIANT = "preview";

    try {
      let runtimeEnv: ReturnType<typeof getPublicEnv> | undefined;

      jest.isolateModules(() => {
        const envModule = require("./env") as typeof import("./env");
        runtimeEnv = envModule.getRuntimeEnv();
      });

      expect(runtimeEnv).toEqual({
        backendUrl: "https://fallback-api.yuzik.example",
        supabaseUrl: "https://fallback-project.supabase.co",
        supabaseAnonKey: "fallback-anon-key",
        appScheme: "yuzik-dev-fallback",
        buildChannel: "runtime-fallback",
        debugMenuEnabled: true,
        debugNetworkLoggingEnabled: false,
      });
    } finally {
      process.env = previousEnv;
      jest.dontMock("expo-constants");
      jest.resetModules();
    }
  });
});
