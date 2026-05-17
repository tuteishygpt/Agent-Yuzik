import { redirectSystemPath } from "../../app/+native-intent";

describe("redirectSystemPath", () => {
  it.each([
    "yuzik-dev:///",
    "yuzik-dev://?disableOnboarding=1",
    "yuzik-dev://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081",
    "exp+yuzik-mobile://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081",
  ])("redirects Expo dev launcher URL %s to the default chat route", (path) => {
    expect(redirectSystemPath({ path, initial: true })).toBe("/chat");
  });

  it.each([
    "yuzik-dev://auth/callback?code=abc",
    "yuzik-dev:///auth/callback?code=abc",
    "/voice",
    "/",
  ])("keeps app route %s unchanged", (path) => {
    expect(redirectSystemPath({ path, initial: true })).toBe(path);
  });
});
