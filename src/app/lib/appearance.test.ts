import { describe, expect, it } from "vitest";
import { ACCENTS, ACCENT_SWATCH, DEFAULT_APPEARANCE, parseAppearance } from "./appearance";

describe("parseAppearance", () => {
  it("is the blue accent when nothing is stored", () => {
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(DEFAULT_APPEARANCE).toEqual({ accent: "blue" });
  });

  it("keeps a valid accent, drops what it does not know (an old light/dark choice included)", () => {
    expect(parseAppearance(JSON.stringify({ accent: "purple" }))).toEqual({ accent: "purple" });
    expect(parseAppearance(JSON.stringify({ theme: "light", accent: "green" }))).toEqual({ accent: "green" });
    expect(parseAppearance(JSON.stringify({ accent: "magenta" }))).toEqual({ accent: "blue" });
    expect(parseAppearance("{not json")).toEqual(DEFAULT_APPEARANCE);
  });
});

describe("accents", () => {
  it("has a swatch for every accent macOS offers", () => {
    expect(ACCENTS).toEqual(["blue", "purple", "pink", "red", "orange", "yellow", "green", "graphite"]);
    for (const a of ACCENTS) expect(ACCENT_SWATCH[a]).toMatch(/^#[0-9a-f]{6}$/);
  });
});
