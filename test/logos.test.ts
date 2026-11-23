import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OUT, SITE, renderLogos, renderSiteLogos } from "../scripts/tool-logos";

describe("tool logos", () => {
  it("match design/logos and Simple Icons (run `npm run site:logos`)", () => {
    expect(readFileSync(OUT, "utf8")).toBe(renderLogos());
  });

  it("and the website's logo wall is drawn from the same marks (run `npm run site:logos`)", () => {
    const html = readFileSync(SITE, "utf8");
    expect(html).toContain("<!-- logos:tools -->");
    expect(html).toBe(renderSiteLogos(html));
  });
});
