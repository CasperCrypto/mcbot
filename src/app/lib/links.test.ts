import { afterEach, describe, expect, it, vi } from "vitest";
import { STAR_AFTER, markStarAsked, shouldAskForStar } from "./links";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });

describe("asking for a star", () => {
  afterEach(() => store.clear());

  it("waits for a few good answers, then asks once", () => {
    expect(shouldAskForStar(STAR_AFTER - 1, true)).toBe(false);
    expect(shouldAskForStar(STAR_AFTER, true)).toBe(true);
    markStarAsked();
    expect(shouldAskForStar(STAR_AFTER + 10, true)).toBe(false);
  });

  it("never asks in a window that joined someone else's McBot", () => {
    expect(shouldAskForStar(50, false)).toBe(false);
  });
});
