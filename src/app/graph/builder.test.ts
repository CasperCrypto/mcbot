import { describe, expect, it } from "vitest";
import { compile, resolveGraph } from "../../compile";
import { GRAPH_SCHEMA, type Graph, type GraphNode } from "../../contracts/graph";
import { parsePlan } from "../../harness/plan";
import { PLAN_CHOICES, planToBoard, quickPlan } from "./builder";

const model = { id: "m", kind: "model", position: { x: 0, y: 0 }, data: { name: "local", label: "Local", endpoint: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3:8b", apiKeyEnv: "", pricing: null } } as GraphNode;
const newModel = (position: { x: number; y: number }) => ({ ...model, id: "m-new", position }) as GraphNode;
const empty: Graph = { schema: GRAPH_SCHEMA, id: "b", name: "B", nodes: [], edges: [] };

const build = (request: string) => {
  const plan = quickPlan(request);
  const add = planToBoard(plan, empty, null, newModel);
  const g: Graph = { ...empty, nodes: add.nodes, edges: add.edges };
  return { plan, add, g, resolved: resolveGraph(g) };
};

describe("Ask McBot: quick plans", () => {
  it("a support team on Slack: roles from the words, a lead, the chat app on the lead, and it compiles", () => {
    const { plan, add, resolved, g } = build("A support team that answers customers on Slack, researches competitors and writes a weekly newsletter");
    expect(plan.agents.map((a) => a.name)).toEqual(["Lead", "Support", "Researcher", "Writer"]);
    expect(plan.agents[0]!.chatApps).toEqual(["slack"]);
    expect(resolved.issues.filter((i) => i.level === "error")).toEqual([]);
    const lead = resolved.bundles.find((b) => b.agent.id === add.lead)!;
    expect(lead.team.map((t) => t.data.displayName).sort()).toEqual(["Researcher", "Support", "Writer"]);
    expect(lead.channels.map((c) => c.data.platform)).toEqual(["slack"]);
    expect(resolved.bundles.find((b) => b.agent.data.displayName === "Researcher")!.tools.map((t) => t.data.name)).toContain("exa");
    expect(compile(g).files.some((f) => f.path === "profiles/lead/SOUL.md")).toBe(true);
    expect(add.skills.map((s) => s.who)).toEqual(expect.arrayContaining(["Support", "Researcher", "Writer"]));
  });
  it("one agent when nothing matches; the loop layer only when asked to keep it short", () => {
    expect(quickPlan("help me think").agents.map((a) => a.name)).toEqual(["Assistant"]);
    const quick = build("a quick code review bot for github");
    expect(quick.plan.agents.map((a) => a.maxSteps)).toEqual([25]);
    expect(quick.resolved.bundles[0]!.agent.data.maxSteps).toBe(25);
  });
});

describe("Ask McBot: a model's plan", () => {
  it("keeps only known ids and hand-offs between its own agents", () => {
    const text = '<think>hm</think>```json\n{"summary":"s","agents":[{"name":"Lead","tools":["exa","made-up"],"chatApps":["slack","myspace"],"skills":["official/research/qmd","official/nope"]},{"name":"Helper"}],"handoffs":[["Lead","Helper"],["Lead","Ghost"]]}\n```';
    const plan = parsePlan(text, PLAN_CHOICES)!;
    expect(plan.agents[0]).toMatchObject({ tools: ["exa"], chatApps: ["slack"], skills: ["official/research/qmd"] });
    expect(plan.handoffs).toEqual([["Lead", "Helper"]]);
    expect(parsePlan("no json here")).toBeNull();
  });
  it("joins a board that already has agents with those names, using its model", () => {
    const g: Graph = { ...empty, nodes: [model, { id: "a", kind: "agent", position: { x: 0, y: 0 }, data: { name: "researcher", displayName: "", description: "", soul: "", skills: [], capabilities: null } } as GraphNode], edges: [{ id: "e", source: "m", target: "a", order: 0 }] };
    const add = planToBoard(quickPlan("research and write"), g, model as Extract<GraphNode, { kind: "model" }>, newModel);
    expect(add.nodes.filter((n) => n.kind === "agent").map((n) => n.data.name)).toEqual(["researcher-2", "writer"]);
    expect(add.nodes.some((n) => n.kind === "model")).toBe(false);
    const all = { ...g, nodes: [...g.nodes, ...add.nodes], edges: [...g.edges, ...add.edges] };
    expect(resolveGraph(all).issues.filter((i) => i.level === "error")).toEqual([]);
  });
});
