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

describe("hand-off edges (agent → agent)", () => {
  const team = (edges: object[]) => resolveGraph(graph([agent("a", "lead"), agent("b", "writer"), agent("c", "editor"), model("m", "local")], [
    { id: "m1", source: "m", target: "a" }, { id: "m2", source: "m", target: "b" }, { id: "m3", source: "m", target: "c" }, ...edges,
  ]));
  it("gives the source agent its team, by name, in either direction once", () => {
    const r = team([{ id: "h1", source: "a", target: "c" }, { id: "h2", source: "a", target: "b" }, { id: "h3", source: "b", target: "a" }]);
    expect(r.issues).toEqual([]);
    expect(r.bundles.map((b) => [b.agent.data.name, b.team.map((t) => t.data.name)])).toEqual([["editor", []], ["lead", ["editor", "writer"]], ["writer", ["lead"]]]);
  });
  it("refuses an agent handing work to itself, or to the same agent twice", () => {
    expect(team([{ id: "h1", source: "a", target: "a" }]).issues.map((i) => i.message)).toEqual(['agent "lead" cannot hand work to itself']);
    expect(team([{ id: "h1", source: "a", target: "b" }, { id: "h2", source: "a", target: "b" }]).issues.map((i) => i.message)).toEqual(['agent "lead" hands work to agent "writer" twice']);
  });
});

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
      'error: "default" is reserved and cannot be an agent ID',
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
      'error: Two agents are named "bot"; agent IDs must be unique',
    );
    expect(messages(graph([]))).toEqual(["error: Nothing to compile: add an agent node"]);
  });

  it("only allows agent↔model and agent↔tool wiring", () => {
    expect(messages(graph([agent("a", "bot"), model("m", "local"), tool("t", "files")], [
      { id: "e1", source: "a", target: "m" },
      { id: "e2", source: "m", target: "t" },
      { id: "e3", source: "a", target: "ghost" },
    ]))).toEqual([
      'error: Cannot connect model "local" to tool "files"; wire models, tools, makers and chat apps to agents',
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

describe("chat apps", () => {
  const withChat = (chat: Record<string, unknown>) => resolveGraph({
    schema: GRAPH_SCHEMA, id: "b", name: "b",
    nodes: [
      { id: "a", kind: "agent", position: { x: 0, y: 0 }, data: { name: "desk" } },
      { id: "m", kind: "model", position: { x: 0, y: 0 }, data: { name: "local", endpoint: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "m" } },
      { id: "c", kind: "channel", position: { x: 0, y: 0 }, data: { name: "chat", ...chat } },
    ],
    edges: [{ id: "e1", source: "a", target: "m" }, { id: "e2", source: "a", target: "c" }],
  }).issues.map((i) => `${i.level}: ${i.message}`);

  it("asks for each plain setting an app needs, and for who may message it", () => {
    expect(withChat({ platform: "irc", settings: { IRC_SERVER: "irc.libera.chat" } })).toEqual([
      'warning: chat app "chat": add your user id, or nobody can message it',
      'warning: chat app "chat": fill in IRC channel',
      'warning: chat app "chat": fill in Bot nickname',
    ]);
  });

  it("keeps Telegram's numeric user ids, and lets other apps use their own ids", () => {
    expect(withChat({ platform: "telegram", allowedUsers: ["ada"] })).toEqual(['error: chat app "chat": Telegram user ids are numbers, like 123456789']);
    expect(withChat({ platform: "slack", allowedUsers: ["U012AB3CD"] })).toEqual([]);
  });
});
