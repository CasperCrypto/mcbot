import { describe, expect, it } from "vitest";
import { resolveGraph } from "../../compile";
import type { Graph } from "../../contracts/graph";
import { hermesTarget } from "./hermesTarget";

const graph: Graph = {
  schema: "mcbot.graph/v1", id: "t", name: "t",
  nodes: [
    { id: "a1", kind: "agent", position: { x: 0, y: 0 }, data: { name: "writer", displayName: "", description: "", soul: "", skills: [], capabilities: null } },
    { id: "m1", kind: "model", position: { x: 0, y: 0 }, data: { name: "local", label: "", endpoint: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3:8b", apiKeyEnv: "", pricing: null } },
    { id: "t1", kind: "tool", position: { x: 0, y: 0 }, data: { name: "exa", label: "", transport: "http", command: "", args: [], env: {}, url: "https://mcp.exa.ai/mcp", headers: {} } },
  ],
  edges: [{ id: "e1", source: "m1", target: "a1", order: 0 }, { id: "e2", source: "a1", target: "t1", order: 0 }],
};

describe("clicking a part of the Hermes picture", () => {
  const { bundles } = resolveGraph(graph);
  it("opens the block that makes it on the board", () => {
    expect(hermesTarget("agent:a1", bundles)).toEqual({ node: "a1" });
    expect(hermesTarget("agent:a1:model", bundles)).toEqual({ node: "m1" });
    expect(hermesTarget("agent:a1:tools", bundles)).toEqual({ node: "t1" });
    expect(hermesTarget("agent:a1:abilities", bundles)).toEqual({ node: "a1" });
    expect(hermesTarget("in:c9", bundles)).toEqual({ node: "c9" });
  });
  it("or the view that owns it", () => {
    expect(hermesTarget("agent:a1:memory", bundles)).toEqual({ tab: "memory" });
    expect(hermesTarget("agent:a1:cron", bundles)).toEqual({ tab: "home" });
    expect(hermesTarget("kanban", bundles)).toEqual({ tab: "tasks" });
    expect(hermesTarget("gateway", bundles)).toEqual({ tab: "settings" });
    expect(hermesTarget("agent:nope", bundles)).toBeNull();
  });
});
