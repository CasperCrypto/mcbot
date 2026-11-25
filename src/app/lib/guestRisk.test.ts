import { describe, expect, it } from "vitest";
import { GraphSchema, type AgentNode } from "../../contracts/graph";
import { guestRisks } from "./guestRisk";

const board = (agent: Record<string, unknown>) => GraphSchema.parse({
  schema: "mcbot.graph/v1", id: "b", name: "B",
  nodes: [
    { id: "a", kind: "agent", position: { x: 0, y: 0 }, data: { name: "a", ...agent } },
    { id: "t", kind: "tool", position: { x: 0, y: 0 }, data: { name: "github", transport: "http", url: "https://api.githubcopilot.com/mcp/" } },
  ],
  edges: [{ id: "e", source: "a", target: "t" }],
});
const risks = (agent: Record<string, unknown>) => { const g = board(agent); return guestRisks(g.nodes[0] as AgentNode, g); };

describe("what a guest could make an agent do", () => {
  it("names the abilities that reach this computer and the tools wired to it", () => {
    expect(risks({ capabilities: ["web", "terminal"] })).toEqual(["Terminal", "github"]);
  });

  it("says when the agent would run a risky command without asking anyone", () => {
    expect(risks({ capabilities: ["web", "terminal"], approvals: "off" })).toEqual(["Terminal", "github", "never asks before risky commands"]);
    expect(risks({ capabilities: ["web", "terminal"], approvals: "manual" })).toEqual(["Terminal", "github"]);
  });
});
