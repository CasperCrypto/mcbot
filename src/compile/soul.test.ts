import { describe, expect, it } from "vitest";
import { AgentDataSchema } from "../contracts/graph";
import { renderSoul } from "./soul";

const agent = (over: object) => AgentDataSchema.parse({ name: "triage", ...over });

describe("renderSoul", () => {
  it("writes the authored soul verbatim, canonicalized, with no McBot header", () => {
    expect(renderSoul(agent({ soul: "You route tickets.\r\n\r\nBe brief.  \n\n" }))).toBe("You route tickets.\n\nBe brief.\n");
  });
  it("falls back to display name and description", () => {
    expect(renderSoul(agent({ displayName: "Triage", description: "Routes tickets." }))).toBe("# Triage\n\nRoutes tickets.\n");
  });
  it("falls back to the profile name alone", () => {
    expect(renderSoul(agent({}))).toBe("# triage\n");
  });
});
