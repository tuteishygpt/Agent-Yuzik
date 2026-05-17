type NativeSystemPathInput = {
  path: string;
  initial: boolean;
};

const DEFAULT_APP_ROUTE = "/chat";
const APP_SCHEMES = new Set(["yuzik-dev:", "exp+yuzik-mobile:"]);
const DEV_LAUNCHER_HOST = "expo-development-client";
const DEV_LAUNCHER_QUERY_KEYS = new Set(["disableOnboarding", "url"]);

export function redirectSystemPath({ path }: NativeSystemPathInput): string {
  if (isExpoDevLauncherPath(path)) {
    return DEFAULT_APP_ROUTE;
  }

  return path;
}

function isExpoDevLauncherPath(path: string): boolean {
  try {
    const url = new URL(path);

    if (!APP_SCHEMES.has(url.protocol.toLowerCase())) {
      return false;
    }

    const host = url.hostname.toLowerCase();

    if (host === DEV_LAUNCHER_HOST) {
      return true;
    }

    if (host) {
      return false;
    }

    const pathname = url.pathname.replace(/\/+/g, "/");
    const isRootPath = pathname === "" || pathname === "/";

    if (!isRootPath) {
      return false;
    }

    return Array.from(url.searchParams.keys()).every((key) =>
      DEV_LAUNCHER_QUERY_KEYS.has(key),
    );
  } catch {
    return false;
  }
}
