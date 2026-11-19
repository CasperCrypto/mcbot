import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OUT, renderLibrary } from "../scripts/hermes-library";

describe("Hermes' skill library list", () => {
  it("matches hermes/optional-skills (run `npm run engine:library` after a Hermes sync)", () => {
    expect(readFileSync(OUT, "utf8")).toBe(renderLibrary());
  });
});
