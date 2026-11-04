import { describe, expect, it } from "vitest";
import { layoutTree } from "./tree";

const opts = { column: 300, row: 40, gap: 10 };

describe("layoutTree", () => {
  it("stacks leaves and centres each parent on its children", () => {
    const pos = layoutTree({ id: "r", children: [{ id: "a" }, { id: "b", children: [{ id: "b1" }, { id: "b2" }] }, { id: "c" }] }, opts);
    expect(Object.fromEntries([...pos].map(([k, v]) => [k, [v.x, v.y]]))).toEqual({
      a: [300, 0],
      b1: [600, 50],
      b2: [600, 100],
      b: [300, 75],
      c: [300, 150],
      r: [0, 75],
    });
  });

  it("never overlaps siblings when nodes have different heights", () => {
    const pos = layoutTree({ id: "r", children: [{ id: "tall", height: 120 }, { id: "short" }] }, opts);
    expect(pos.get("short")!.y).toBeGreaterThanOrEqual(pos.get("tall")!.y + 120 + opts.gap);
  });

  it("is deterministic", () => {
    const tree = { id: "r", children: [{ id: "x" }, { id: "y" }] };
    expect([...layoutTree(tree, opts)]).toEqual([...layoutTree(tree, opts)]);
  });
});
