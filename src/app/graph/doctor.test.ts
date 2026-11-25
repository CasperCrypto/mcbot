import { describe, expect, it } from "vitest";
import { GRAPH_SCHEMA, type Graph, type GraphEdge, type GraphNode } from "../../contracts/graph";
import { checkHarness, sizeB, type DoctorContext } from "./doctor";

const agent = (id: string, name: string, extra: Record<string, unknown> = {}): GraphNode => ({ id, kind: "agent", position: { x: 0, y: 0 }, data: { name, displayName: name, description: "", soul: "", skills: [], capabilities: null, ...extra } } as unknown as GraphNode);
const local = (id: string): GraphNode => ({ id, kind: "model", position: { x: 0, y: 0 }, data: { name: id, label: "Ollama", endpoint: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3:8b", apiKeyEnv: "", pricing: null } } as unknown as GraphNode);
const cloud = (id: string, pricing: unknown = null): GraphNode => ({ id, kind: "model", position: { x: 0, y: 0 }, data: { name: id, label: "OpenRouter", endpoint: "cloud", baseUrl: "https://openrouter.ai/api/v1", model: "x/y", apiKeyEnv: "OPENROUTER_API_KEY", pricing } } as unknown as GraphNode);
const edge = (id: string, source: string, target: string, order = 0): GraphEdge => ({ id, source, target, order });
const board = (nodes: GraphNode[], edges: GraphEdge[] = []): Graph => ({ schema: GRAPH_SCHEMA, id: "b", name: "b", nodes, edges });
const ctx = (over: Partial<DoctorContext> = {}): DoctorContext => ({ keys: [], health: {}, drift: 0, engineReady: true, ...over });
const ids = (g: Graph, c = ctx()) => checkHarness(g, c).map((f) => `${f.level}:${f.id}`);

const tool = (id: string, data: Record<string, unknown>): GraphNode => ({ id, kind: "tool", position: { x: 0, y: 0 }, data: { name: id, label: id, transport: "stdio", command: "npx", args: [], env: {}, url: "", headers: {}, ...data } } as unknown as GraphNode);

describe("harness doctor", () => {
  it("asks for a tool's key: a hosted server can't connect without it, a local one may not work", () => {
    const gh = tool("gh", { label: "GitHub", transport: "http", command: "", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer ${env:GITHUB_PERSONAL_ACCESS_TOKEN}" } });
    const brave = tool("brave", { env: { BRAVE_API_KEY: "${env:BRAVE_API_KEY}" } });
    const g = board([agent("a", "writer"), local("m"), gh, brave], [edge("e1", "m", "a"), edge("e2", "a", "gh"), edge("e3", "a", "brave")]);
    const f = checkHarness(g, ctx({ health: { m: "ok" } }));
    expect(f.map((x) => `${x.level}:${x.id}`)).toEqual(["error:tool-key-gh-GITHUB_PERSONAL_ACCESS_TOKEN", "warn:tool-key-brave-BRAVE_API_KEY"]);
    expect(f[0]!.fix).toEqual({ kind: "select", nodeId: "gh", label: "Add key" });
    expect(ids(g, ctx({ health: { m: "ok" }, keys: ["GITHUB_PERSONAL_ACCESS_TOKEN", "BRAVE_API_KEY"] }))).toEqual([]);
  });

  it("finds two agents people can't tell apart, and renames the later one", () => {
    const g = board([agent("a", "writer", { displayName: "Writer" }), agent("b", "writer-2", { displayName: "Writer" }), agent("c", "writer-3", { displayName: "writer" }), local("m")], [edge("e1", "m", "a"), edge("e2", "m", "b"), edge("e3", "m", "c")]);
    const f = checkHarness(g, ctx({ health: { m: "ok" } }));
    expect(f.map((x) => x.id)).toEqual(["twin-b", "twin-c"]);
    expect(f.map((x) => x.fix)).toEqual([{ kind: "rename", nodeId: "b", name: "Writer 2", label: "Rename" }, { kind: "rename", nodeId: "c", name: "writer 3", label: "Rename" }]);
  });

  it("reads a model's size from its id", () => {
    expect(sizeB("qwen3:8b")).toBe(8);
    expect(sizeB("DeepSeek-V4-Pro-Qwen3.5-9B")).toBe(9);
    expect(sizeB("llama3.1:70b-instruct-q4_K_M")).toBe(70);
    expect(sizeB("gemma3:4b")).toBe(4);
    expect(sizeB("mixtral-8x7b")).toBeNull(); // a mixture of experts, 47B in all: not "small"
    expect(sizeB("gpt-5")).toBeNull();
    expect(sizeB("claude-sonnet-4.5")).toBeNull();
  });

  it("tips a lead that hands work to a team on a small local model, not one on a big or cloud model", () => {
    const small = { ...local("m"), data: { ...(local("m").data as object), model: "DeepSeek-V4-Pro-Qwen3.5-9B" } } as GraphNode;
    const g = board([agent("lead", "lead"), agent("w", "writer"), small], [edge("e1", "m", "lead"), edge("e2", "m", "w"), edge("h", "lead", "w")]);
    const f = checkHarness(g, ctx({ health: { m: "ok" } }));
    expect(f.map((x) => x.id)).toEqual(["small-lead-lead"]);
    expect(f[0]!.fix).toEqual({ kind: "settings", page: "models", label: "Pick a model" });
    const big = { ...small, data: { ...(small.data as object), model: "qwen3:32b" } } as GraphNode;
    expect(ids(board([agent("lead", "lead"), agent("w", "writer"), big], [edge("e1", "m", "lead"), edge("e2", "m", "w"), edge("h", "lead", "w")]), ctx({ health: { m: "ok" } }))).toEqual([]);
  });

  it("is quiet about a healthy board", () => {
    expect(ids(board([agent("a", "writer"), local("m")], [edge("e", "m", "a")]), ctx({ health: { m: "ok" } }))).toEqual([]);
  });

  it("finds an agent with no model once, with the fix that adds one", () => {
    const f = checkHarness(board([agent("a", "writer")]), ctx());
    expect(f.map((x) => x.id)).toEqual(["no-model-a"]);
    expect(f[0]!.fix).toEqual({ kind: "settings", page: "models", label: "Add model" });
  });

  it("puts errors first: a missing key before a silent server before tips", () => {
    const g = board([agent("a", "writer"), agent("b", "coder"), cloud("c"), local("m"), local("lonely")], [edge("e1", "c", "a"), edge("e2", "m", "b")]);
    expect(ids(g, ctx({ health: { m: "down" } }))).toEqual(["error:key-c", "warn:down-m", "tip:price-c", "tip:alone-lonely", "tip:budget-a"]);
  });

  it("says nothing about keys while it doesn't know them, and stops nagging once a price and budget are set", () => {
    const g = board([agent("a", "writer", { dailyBudgetUsd: 2 }), cloud("c", { inputPerMTok: 3, outputPerMTok: 15 })], [edge("e", "c", "a")]);
    expect(ids(g, ctx({ keys: null }))).toEqual([]);
  });

  it("doesn't ask for the key of a model no agent uses (it only says the model is alone)", () => {
    expect(ids(board([agent("a", "writer"), local("m"), cloud("c")], [edge("e", "m", "a")]), ctx({ health: { m: "ok" } }))).toEqual(["tip:alone-c"]);
  });

  it("reports files that differ from disk and an engine that isn't ready", () => {
    const g = board([agent("a", "writer"), local("m")], [edge("e", "m", "a")]);
    expect(ids(g, ctx({ drift: 3, engineReady: false, health: { m: "ok" } }))).toEqual(["error:engine", "warn:drift"]);
  });
});
