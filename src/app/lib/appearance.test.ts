import { describe, expect, it } from "vitest";
import { ACCENTS, ACCENT_SWATCH, DEFAULT_APPEARANCE, parseAppearance, resolveTheme } from "./appearance";

describe("parseAppearance", () => {
  it("is McBot's dark look with the blue accent when nothing is stored", () => {
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(DEFAULT_APPEARANCE).toEqual({ theme: "dark", accent: "blue" });
  });

  it("keeps a valid choice and drops what it does not know, field by field", () => {
    expect(parseAppearance(JSON.stringify({ theme: "light", accent: "purple" }))).toEqual({ theme: "light", accent: "purple" });
    expect(parseAppearance(JSON.stringify({ theme: "sepia", accent: "green" }))).toEqual({ theme: "dark", accent: "green" });
    expect(parseAppearance(JSON.stringify({ theme: "system", accent: "magenta" }))).toEqual({ theme: "system", accent: "blue" });
    expect(parseAppearance("{not json")).toEqual(DEFAULT_APPEARANCE);
  });
});

describe("resolveTheme", () => {
  it("follows the system only when asked to", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("accents", () => {
  it("has a swatch for every accent macOS offers", () => {
    expect(ACCENTS).toEqual(["blue", "purple", "pink", "red", "orange", "yellow", "green", "graphite"]);
    for (const a of ACCENTS) expect(ACCENT_SWATCH[a]).toMatch(/^#[0-9a-f]{6}$/);
  });
});
