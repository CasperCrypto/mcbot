import { describe, expect, it } from "vitest";
import { frecency, fuzzyScore } from "./rank";

describe("fuzzyScore", () => {
  it("ranks prefix over word start over inside", () => {
    const a = fuzzyScore("comp", "Compile");
    const b = fuzzyScore("comp", "Live compile");
    const c = fuzzyScore("comp", "Recompile");
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(c).toBeGreaterThan(0);
  });
  it("needs every word, in any order", () => {
    expect(fuzzyScore("model add", "Add a model")).toBeGreaterThan(0);
    expect(fuzzyScore("model zebra", "Add a model")).toBe(0);
  });
  it("finds letters in order, but not for one or two letters", () => {
    expect(fuzzyScore("cmpl", "Compile")).toBeGreaterThan(0);
    expect(fuzzyScore("xq", "Compile")).toBe(0);
    expect(fuzzyScore("ce", "Compile")).toBe(0);
  });
  it("keeps loose matching out of long text when asked", () => {
    expect(fuzzyScore("resear", "Models, keys, wires, budgets, files: what is wrong", false)).toBe(0);
    expect(fuzzyScore("cmpl", "Compile", false)).toBe(0);
  });
  it("is empty for an empty query", () => {
    expect(fuzzyScore("  ", "Compile")).toBe(0);
  });
});

describe("frecency", () => {
  const now = 1_000_000_000_000;
  it("counts recent use more than old use", () => {
    expect(frecency({ n: 3, at: now }, now)).toBeGreaterThan(frecency({ n: 3, at: now - 30 * 86_400_000 }, now));
    expect(frecency(undefined, now)).toBe(0);
  });
  it("lets many uses beat one", () => {
    expect(frecency({ n: 10, at: now - 86_400_000 }, now)).toBeGreaterThan(frecency({ n: 1, at: now }, now));
  });
});
