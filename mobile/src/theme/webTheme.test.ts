import { webTheme } from "./webTheme";

describe("webTheme", () => {
  it("keeps mobile aligned with the Figma light reference colors", () => {
    expect(webTheme.colors.background).toBe("#f8f5f0");
    expect(webTheme.colors.surface).toBe("#ffffff");
    expect(webTheme.colors.primary).toBe("#d83324");
    expect(webTheme.colors.text).toBe("#1f1d1b");
    expect(webTheme.radii.md).toBe(8);
  });

  it("keeps compatibility status color names", () => {
    expect(webTheme.colors.listening).toBeTruthy();
    expect(webTheme.colors.processing).toBeTruthy();
    expect(webTheme.colors.speaking).toBeTruthy();
    expect(webTheme.colors.danger).toBeTruthy();
  });
});
