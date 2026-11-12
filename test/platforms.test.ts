import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OUT, renderPlatforms } from "../scripts/hermes-platforms";

describe("chat apps, generated from Hermes' platform plugins", () => {
  it("match hermes/plugins/platforms (run `npm run engine:platforms` after a Hermes sync)", () => {
    expect(readFileSync(OUT, "utf8")).toBe(renderPlatforms());
  });
});
