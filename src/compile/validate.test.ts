import { describe, expect, it } from "vitest";
import { GRAPH_SCHEMA } from "../contracts/graph";
import { resolveGraph } from "./validate";

const agent = (id: string, name: string) => ({ id, kind: "agent", position: { x: 0, y: 0 }, data: { name } });
const model = (id: string, name: string, extra: object = {}) => ({
  id, kind: "model", position: { x: 0, y: 0 },
  data: { name, endpoint: "local", baseUrl: "http://127.0.0.1:1234/v1", model: "m", ...extra },
});
const tool = (id: string, name: string, extra: object = {}) => ({ id, kind: "tool", position: { x: 0, y: 0 }, data: { name, transport: "stdio", command: "srv", ...extra } });
const graph = (nodes: object[], edges: object[] = []) => ({ schema: GRAPH_SCHEMA, id: "g", name: "G", nodes, edges });
const messages = (g: object) => resolveGraph(g).issues.map((i) => `${i.level}: ${i.message}`);

describe("resolveGraph", () => {
  it("accepts agent + model + tool", () => {
    const r = resolveGraph(graph([agent("a", "bot"), model("m", "local"), tool("t", "files")], [
      { id: "e1", source: "a", target: "m" },
      { id: "e2", source: "t", target: "a" },
    ]));
    expect(r.issues).toEqual([]);
    expect(r.bundles.map((b) => [b.agent.data.name, b.models.map((m) => m.data.name), b.tools.map((t) => t.data.name)])).toEqual([["bot", ["local"], ["files"]]]);
  });

  it("rejects what Hermes would reject or misread", () => {
    expect(messages(graph([agent("a", "default"), model("m", "local")], [{ id: "e", source: "a", target: "m" }]))).toContain(
      'error: "default" is reserved by Hermes and cannot be a profile name',
    );
    expect(messages(graph([agent("a", "Bad Name")]))[0]).toMatch(/^error: Agent "Bad Name": ID: lowercase profile id/);
    // A half-filled node is an error, but the rest of the board still resolves for the views.
    const half = resolveGraph(graph([agent("a", "bot"), model("m", "local"), model("c", "cloud", { endpoint: "cloud", model: "" })], [{ id: "e", source: "m", target: "a" }]));
    expect(half.issues.find((i) => i.nodeId === "c")?.message).toBe('Model "cloud": Model is required');
    expect(half.bundles.map((b) => [b.agent.data.name, b.models.map((m) => m.data.name)])).toEqual([["bot", ["local"]]]);
    expect(messages(graph([agent("a", "bot")]))).toContain('error: Agent "bot" has no model; wire a model node to it');
    expect(messages(graph([agent("a", "bot"), model("m", "c", { endpoint: "cloud", baseUrl: "https://x/v1" })], [{ id: "e", source: "a", target: "m" }]))).toContain(
      'error: Cloud model "c" needs the name of the env var that holds its API key',
    );
    expect(messages(graph([agent("a", "bot"), agent("b", "bot")]))).toContain(
      'error: Two agents are named "bot"; agent names are Hermes profile ids and must be unique',
    );
    expect(messages(graph([]))).toEqual(["error: Nothing to compile: add an agent node"]);
  });

  it("only allows agent↔model and agent↔tool wiring", () => {
    expect(messages(graph([agent("a", "bot"), model("m", "local"), tool("t", "files")], [
      { id: "e1", source: "a", target: "m" },
      { id: "e2", source: "m", target: "t" },
      { id: "e3", source: "a", target: "ghost" },
    ]))).toEqual([
      'error: Cannot connect model "local" to tool "files"; wire models and tools to agents',
      "error: Edge e3 points at a node that does not exist",
      'warning: tool "files" is not wired to any agent and will not be compiled',
    ]);
  });

  it("is independent of node and edge array order", () => {
    const nodes = [agent("a", "bot"), model("m1", "one"), model("m2", "two")];
    const edges = [{ id: "e2", source: "a", target: "m2", order: 1 }, { id: "e1", source: "a", target: "m1", order: 0 }];
    const fwd = resolveGraph(graph(nodes, edges)).bundles[0]!.models.map((m) => m.data.name);
    const rev = resolveGraph(graph([...nodes].reverse(), [...edges].reverse())).bundles[0]!.models.map((m) => m.data.name);
    expect(fwd).toEqual(["one", "two"]);
    expect(rev).toEqual(fwd);
  });
});
