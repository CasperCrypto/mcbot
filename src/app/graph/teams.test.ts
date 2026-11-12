import { describe, expect, it } from "vitest";
import { compile, resolveGraph } from "../../compile";
import { GRAPH_SCHEMA, type Graph, type GraphNode } from "../../contracts/graph";
import { TEAMS, teamToAdd } from "./teams";

const model = { id: "m", kind: "model", position: { x: 0, y: 0 }, data: { name: "local", label: "Local", endpoint: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3:8b", apiKeyEnv: "", pricing: null } } as GraphNode;
const newModel = (position: { x: number; y: number }) => ({ ...model, id: "m-new", position }) as GraphNode;

describe("starter teams", () => {
  it.each(TEAMS.map((t) => [t.id, t] as const))("%s compiles: every agent has a model and the lead hands work to its team", (_id, team) => {
    const graph: Graph = { schema: GRAPH_SCHEMA, id: "b", name: "B", nodes: [], edges: [] };
    const add = teamToAdd(graph, team, null, newModel);
    const g = { ...graph, nodes: add.nodes, edges: add.edges };
    expect(resolveGraph(g).issues.filter((i) => i.level === "error")).toEqual([]);
    const lead = resolveGraph(g).bundles.find((b) => b.agent.id === add.lead)!;
    expect(lead.team.map((t) => t.data.displayName).sort()).toEqual(team.members.slice(1).map((m) => m.displayName).sort());
    const soul = compile(g).files.find((f) => f.path === `profiles/${lead.agent.data.name}/SOUL.md`)!.content;
    expect(soul).toContain("## Team");
  });

  it("joins a board that already has agents with the same names, and uses its model", () => {
    const graph: Graph = { schema: GRAPH_SCHEMA, id: "b", name: "B", nodes: [model, { id: "a", kind: "agent", position: { x: 0, y: 0 }, data: { name: "writer", displayName: "", description: "", soul: "", skills: [], capabilities: null } } as GraphNode], edges: [{ id: "e", source: "m", target: "a", order: 0 }] };
    const add = teamToAdd(graph, TEAMS[0]!, model as Extract<GraphNode, { kind: "model" }>, newModel);
    expect(add.nodes.map((n) => n.data.name)).toEqual(["lead", "researcher", "writer-2"]);
    const g = { ...graph, nodes: [...graph.nodes, ...add.nodes], edges: [...graph.edges, ...add.edges] };
    expect(resolveGraph(g).issues.filter((i) => i.level === "error")).toEqual([]);
  });
});
