import { webTheme } from "./webTheme";

describe("webTheme", () => {
  it("keeps mobile aligned with the web voice reference colors", () => {
    expect(webTheme.colors.background).toBe("#0f111a");
    expect(webTheme.colors.primary).toBe("#4e82ee");
    expect(webTheme.colors.listening).toBe("#ff4466");
    expect(webTheme.colors.processing).toBe("#ffaa00");
    expect(webTheme.colors.speaking).toBe("#44ffaa");
  });
});
