import { describe, expect, it } from "vitest";
import type { Graph, GraphNode } from "../contracts/graph";
import type { RunSummary } from "../contracts/run";
import { addVersion, describeChanges, harnessHash, versionStats, type HarnessVersion } from "./versions";

const agent = (id: string, name: string, extra: Record<string, unknown> = {}): GraphNode =>
  ({ id, kind: "agent", position: { x: 0, y: 0 }, data: { name, displayName: name[0]!.toUpperCase() + name.slice(1), description: "", soul: "", skills: [], capabilities: null, ...extra } }) as GraphNode;
const model = (id: string, m: string): GraphNode =>
  ({ id, kind: "model", position: { x: 0, y: 0 }, data: { name: id, label: "", endpoint: "cloud", baseUrl: "https://openrouter.ai/api/v1", model: m, apiKeyEnv: "OPENROUTER_API_KEY", pricing: null } }) as GraphNode;
const board = (nodes: GraphNode[], edges: Graph["edges"] = []): Graph => ({ schema: "mcbot.graph/v1", id: "b", name: "b", nodes, edges });

const v1 = board([agent("a", "researcher"), model("m1", "anthropic/claude-sonnet-4.5")], [{ id: "e1", source: "m1", target: "a", order: 0 }]);

describe("harness versions", () => {
  it("fingerprint the harness, not where blocks sit or the notes", () => {
    const moved = board(v1.nodes.map((n) => ({ ...n, position: { x: 99, y: 99 } })), v1.edges);
    const noted: Graph = { ...v1, notes: [{ id: "n", text: "hi", color: "yellow", position: { x: 0, y: 0 }, pinned: false, author: "", at: 1 }] };
    expect(harnessHash(moved)).toBe(harnessHash(v1));
    expect(harnessHash(noted)).toBe(harnessHash(v1));
    const reordered = board([...v1.nodes].reverse(), v1.edges);
    expect(harnessHash(reordered)).toBe(harnessHash(v1));
    expect(harnessHash(board(v1.nodes.map((n) => (n.kind === "agent" ? agent("a", "researcher", { maxSteps: 10 }) : n)), v1.edges))).not.toBe(harnessHash(v1));
  });

  it("say what changed in words", () => {
    expect(describeChanges(null, v1)).toEqual(["First version: 1 agent, 1 block"]);
    const v2 = board([agent("a", "researcher", { reasoning: "high", maxSteps: 20 }), model("m1", "openai/gpt-4o-mini"), agent("w", "writer")],
      [{ id: "e1", source: "m1", target: "a", order: 0 }, { id: "e2", source: "a", target: "w", order: 0 }]);
    expect(describeChanges(v1, v2)).toEqual([
      "Added agent Writer",
      "Researcher: steps per message any → 20",
      "Researcher: thinking default → high",
      "Model Claude Sonnet 4.5 → GPT-4o mini",
      "Researcher hands work to Writer",
    ]);
  });

  it("keep a new version only when the harness changed", () => {
    let list: HarnessVersion[] = addVersion([], v1, 1000);
    expect(list).toHaveLength(1);
    list = addVersion(list, board(v1.nodes.map((n) => ({ ...n, position: { x: 5, y: 5 } })), v1.edges), 2000);
    expect(list).toHaveLength(1);
    list = addVersion(list, board([...v1.nodes, agent("w", "writer")], v1.edges), 3000);
    expect(list.map((v) => v.at)).toEqual([1000, 3000]);
    expect(list[1]!.changes).toEqual(["Added agent Writer"]);
  });

  it("count each run against the version live when it started", () => {
    const list = addVersion(addVersion([], v1, 1000), board([...v1.nodes, agent("w", "writer")], v1.edges), 5000);
    const run = (startedAt: number, status: RunSummary["status"], usd: number | null, ms: number): RunSummary =>
      ({ runId: `r${startedAt}`, boardId: "b", agentNodeId: "a", profile: "researcher", prompt: "p", status, startedAt, finishedAt: startedAt + ms, text: "", error: null, tokens: { input: 100, output: 20 }, reportedUsd: usd, estimatedUsd: null }) as unknown as RunSummary;
    const stats = versionStats(list, [run(500, "succeeded", 1, 10), run(1500, "succeeded", 0.02, 1000), run(2500, "failed", 0.04, 3000), run(6000, "succeeded", 0.01, 500)]);
    expect(stats.get(list[0]!.id)).toEqual({ runs: 2, succeeded: 1, failed: 1, usdPerRun: 0.03, msPerRun: 2000, tokensPerRun: 120 });
    expect(stats.get(list[1]!.id)).toEqual({ runs: 1, succeeded: 1, failed: 0, usdPerRun: 0.01, msPerRun: 500, tokensPerRun: 120 });
  });
});
