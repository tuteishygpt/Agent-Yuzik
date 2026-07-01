import { webTheme } from "./webTheme";

describe("webTheme", () => {
  it("keeps mobile aligned with the Figma red and neutral tokens", () => {
    expect(webTheme.colors.background).toBe("#fff9f9");
    expect(webTheme.colors.surface).toBe("#fffdfd");
    expect(webTheme.colors.surfaceMuted).toBe("#eeecec");
    expect(webTheme.colors.primary).toBe("#cc3d37");
    expect(webTheme.colors.primarySoft).toBe("#fff0ef");
    expect(webTheme.colors.border).toBe("#ffb3af");
    expect(webTheme.colors.text).toBe("#0e0909");
    expect(webTheme.colors.overlay).toBe("rgba(14, 9, 9, 0.28)");
  });

  it("keeps Figma sizing tokens available to shared mobile components", () => {
    expect(webTheme.radii.sm).toBe(4);
    expect(webTheme.radii.basic).toBe(20);
    expect(webTheme.radii.textBar).toBe(24);
    expect(webTheme.radii.cta).toBe(48);
    expect(webTheme.sizes.menuWidth).toBe(280);
    expect(webTheme.sizes.menuRowHeight).toBe(40);
    expect(webTheme.sizes.inputControl).toBe(38);
    expect(webTheme.sizes.ctaHeight).toBe(48);
  });

  it("keeps compatibility status color names", () => {
    expect(webTheme.colors.listening).toBeTruthy();
    expect(webTheme.colors.processing).toBeTruthy();
    expect(webTheme.colors.speaking).toBeTruthy();
    expect(webTheme.colors.danger).toBeTruthy();
  });
});
