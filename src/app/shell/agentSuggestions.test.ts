import { describe, expect, it } from "vitest";
import { AGENT_SUGGESTIONS, agentIdFor } from "./agentSuggestions";

describe("agent suggestions", () => {
  it("each makes a valid, distinct profile id", () => {
    const ids = AGENT_SUGGESTIONS.map((s) => agentIdFor(s.name, new Set()));
    expect(new Set(ids).size).toBe(AGENT_SUGGESTIONS.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  });
  it("carry a name, a purpose and a soul", () => {
    for (const s of AGENT_SUGGESTIONS) expect(s.name && s.about && s.soul).toBeTruthy();
  });
});

describe("agent suggestions' Hermes skills", () => {
  it("name only skills Hermes' library ships", async () => {
    const { LIBRARY } = await import("../../contracts/library.generated");
    const ids = new Set(LIBRARY.map((s) => s.id));
    for (const s of AGENT_SUGGESTIONS) for (const id of s.skills ?? []) expect(ids.has(id), `${s.name}: ${id}`).toBe(true);
  });
});
