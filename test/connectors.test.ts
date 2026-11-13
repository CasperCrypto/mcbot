import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OUT, renderConnectors } from "../scripts/hermes-connectors";

describe("connectors, generated from Hermes' MCP catalog", () => {
  it("match hermes/optional-mcps (run `npm run engine:connectors` after a Hermes sync)", () => {
    expect(readFileSync(OUT, "utf8")).toBe(renderConnectors());
  });
});
