import { describe, expect, it } from "vitest";
import { ACCENTS, ACCENT_SWATCH, DEFAULT_APPEARANCE, parseAppearance, stepScale } from "./appearance";

describe("parseAppearance", () => {
  it("is the blue accent when nothing is stored", () => {
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(DEFAULT_APPEARANCE).toEqual({ accent: "blue", scale: 1.2 });
  });

  it("keeps a valid accent, drops what it does not know (an old light/dark choice included)", () => {
    expect(parseAppearance(JSON.stringify({ accent: "purple" }))).toEqual({ accent: "purple", scale: 1.2 });
    expect(parseAppearance(JSON.stringify({ accent: "purple", scale: 1.3 }))).toEqual({ accent: "purple", scale: 1.3 });
    expect(parseAppearance(JSON.stringify({ accent: "purple", scale: 7 }))).toEqual({ accent: "purple", scale: 1.2 });
    expect(parseAppearance(JSON.stringify({ theme: "light", accent: "green" }))).toEqual({ accent: "green", scale: 1.2 });
    expect(parseAppearance(JSON.stringify({ accent: "magenta" }))).toEqual({ accent: "blue", scale: 1.2 });
    expect(parseAppearance("{not json")).toEqual(DEFAULT_APPEARANCE);
  });
});

describe("accents", () => {
  it("has a swatch for every accent macOS offers", () => {
    expect(ACCENTS).toEqual(["blue", "purple", "pink", "red", "orange", "yellow", "green", "graphite"]);
    for (const a of ACCENTS) expect(ACCENT_SWATCH[a]).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("stepScale", () => {
  it("moves one size up or down and stops at either end", () => {
    expect(stepScale(1.2, 1)).toBe(1.3);
    expect(stepScale(1.2, -1)).toBe(1.1);
    expect(stepScale(1, -1)).toBe(1);
    expect(stepScale(1.45, 1)).toBe(1.45);
  });
});
