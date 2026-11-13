import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OUT, renderLogos } from "../scripts/tool-logos";

describe("tool logos", () => {
  it("match design/logos and Simple Icons (run `npm run site:logos`)", () => {
    expect(readFileSync(OUT, "utf8")).toBe(renderLogos());
  });
});
