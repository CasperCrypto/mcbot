import { describe, expect, it } from "vitest";
import { layersOver, overlaps, type Box } from "./layers";

const box = (left: number, top: number, w: number, h: number): Box => ({ left, top, right: left + w, bottom: top + h });
const el = (b: Box, kids: unknown[] = []) => ({ getBoundingClientRect: () => b, contains: (o: unknown) => kids.includes(o) });

describe("floating layers over a native page", () => {
  const page = box(100, 120, 800, 500);

  it("sees a menu that opens over the page, and none that stays beside it", () => {
    // The ask bar's agent picker opens upward from below the page, into it.
    expect(layersOver(el(page), [el(box(140, 560, 240, 200))])).toBe(true);
    // A menu in the toolbar above the page, ending at its edge.
    expect(layersOver(el(page), [el(box(140, 40, 240, 80))])).toBe(false);
  });

  it("sees the island once it grows into the page, not while it rests in the title bar", () => {
    expect(layersOver(el(page), [el(box(380, 0, 220, 30))])).toBe(false);
    expect(layersOver(el(page), [el(box(200, 0, 600, 420))])).toBe(true);
  });

  it("ignores closed (empty) layers and the page's own parts", () => {
    expect(layersOver(el(page), [el(box(300, 300, 0, 0))])).toBe(false);
    const own = el(box(300, 300, 100, 100));
    expect(layersOver(el(page, [own]), [own])).toBe(false);
  });

  it("does not count touching edges as overlap", () => {
    expect(overlaps(box(0, 0, 100, 100), box(100, 0, 100, 100))).toBe(false);
    expect(overlaps(box(0, 0, 100, 100), box(99, 0, 100, 100))).toBe(true);
  });
});
