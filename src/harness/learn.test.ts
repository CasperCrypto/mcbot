import { describe, expect, it } from "vitest";
import type { RunEvent, RunSummary } from "../contracts/run";
import { agentStats, conversationsOf, datasetLines, passes, rewardOf, runMessages, toShareGpt, type Check } from "./learn";

const base = (runId: string) => ({ v: 1 as const, runId, ts: 0 });
function run(runId: string, prompt: string, answer: string, tools: { tool: string; input: unknown; output: string }[] = []): RunEvent[] {
  let seq = 0;
  const ev: RunEvent[] = [{ ...base(runId), seq: seq++, type: "run.started", boardId: "b", agentNodeId: "a", profile: "designer", prompt, argv: [], hermesHome: "/h", cwd: "/c" }];
  for (const t of tools) {
    ev.push({ ...base(runId), seq: seq++, type: "run.tool.started", tool: t.tool, input: t.input, toolNodeId: null });
    ev.push({ ...base(runId), seq: seq++, type: "run.tool.finished", tool: t.tool, output: t.output, durationMs: 5, isError: false, toolNodeId: null });
  }
  ev.push({ ...base(runId), seq: seq++, type: "run.text", text: answer });
  return ev;
}
const summary = (runId: string, over: Partial<RunSummary> = {}): RunSummary => ({
  runId, boardId: "b", agentNodeId: "a", profile: "designer", prompt: "p", status: "succeeded", startedAt: 1, finishedAt: 2, sessionId: null,
  model: "m", text: "", tokens: null, toolCalls: 0, toolErrors: 0, error: null, reportedUsd: null, estimatedUsd: null, approval: null, ...over,
});

describe("checks and rewards", () => {
  const checks: Check[] = [
    { id: "1", kind: "includes", value: "price, Leeds" },
    { id: "2", kind: "usedTool", value: "image_generate" },
    { id: "3", kind: "maxWords", value: "10" },
  ];
  it("grade an answer by what it says and what it used", () => {
    expect(passes(checks[0]!, { text: "Our price in Leeds is £4", tools: [] })).toBe(true);
    expect(passes(checks[0]!, { text: "Our price is £4", tools: [] })).toBe(false);
    expect(passes(checks[1]!, { text: "", tools: ["image_generate"] })).toBe(true);
    expect(passes({ id: "4", kind: "excludes", value: "guarantee" }, { text: "We guarantee it", tools: [] })).toBe(false);
    expect(passes({ id: "5", kind: "json", value: "" }, { text: "Here:\n```json\n{\"a\": 1}\n```", tools: [] })).toBe(true);
    expect(passes({ id: "6", kind: "json", value: "" }, { text: "{nope", tools: [] })).toBe(false);
    expect(passes({ id: "7", kind: "minWords", value: "3" }, { text: "one two", tools: [] })).toBe(false);
  });
  it("prefer the person's rating, then the checks; a failed run is 0; nothing known is null", () => {
    expect(rewardOf(summary("r", { text: "Price in Leeds" }), null, checks, ["image_generate"])).toBe(1);
    expect(rewardOf(summary("r", { text: "Price in Leeds" }), null, checks, [])).toBeCloseTo(2 / 3);
    expect(rewardOf(summary("r", { text: "x" }), { score: 1, at: 0 }, checks)).toBe(1);
    expect(rewardOf(summary("r", { status: "failed" }), null, checks)).toBe(0);
    expect(rewardOf(summary("r"), null, [])).toBeNull();
  });
});

describe("runs as training data", () => {
  const a = run("run_a_1", "Make an image for our Monday post", "Here is the image: cache/1.png", [{ tool: "image_generate", input: { prompt: "sourdough loaf, morning light" }, output: "{\"success\": true, \"image\": \"cache/1.png\"}" }]);
  const b = run("run_b_2", "Make it warmer", "Warmer version: cache/2.png", [{ tool: "image_generate", input: { prompt: "warmer" }, output: "{\"image\": \"cache/2.png\"}" }]);

  it("turn a run into chat messages with tool calls and their results", () => {
    const { messages, next } = runMessages(a);
    expect(next).toBe(1);
    expect(messages).toEqual([
      { role: "user", content: "Make an image for our Monday post" },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "image_generate", arguments: "{\"prompt\":\"sourdough loaf, morning light\"}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "{\"success\": true, \"image\": \"cache/1.png\"}" },
      { role: "assistant", content: "Here is the image: cache/1.png" },
    ]);
  });

  it("group the runs of one session into one conversation", () => {
    const runs = [summary("run_b_2", { sessionId: "s", startedAt: 5 }), summary("run_a_1", { sessionId: "s", startedAt: 1 }), summary("run_c_3", { startedAt: 3 })];
    expect(conversationsOf(runs).map((c) => c.map((r) => r.runId))).toEqual([["run_a_1", "run_b_2"], ["run_c_3"]]);
  });

  it("write chat, reward and Hermes trajectory lines, keeping only the good ones when asked", () => {
    const runs = [summary("run_a_1", { sessionId: "s" }), summary("run_b_2", { sessionId: "s", startedAt: 2 })];
    const conv = { runs, events: { run_a_1: a, run_b_2: b }, rewards: { run_a_1: 1, run_b_2: 0.5 } };
    const opts = { system: "You are our designer.", model: "m", at: "2026-11-24T00:00:00" };
    const chat = datasetLines([conv], { ...opts, format: "chat", pick: "all" });
    expect(chat.kept).toBe(1);
    const line = JSON.parse(chat.lines[0]!);
    expect(line.messages[0]).toEqual({ role: "system", content: "You are our designer." });
    expect(line.messages.filter((m: { role: string }) => m.role === "user")).toHaveLength(2);
    expect(line.messages.find((m: { tool_calls?: unknown[] }) => m.tool_calls && JSON.stringify(m).includes("call_2"))).toBeTruthy();
    expect(JSON.parse(datasetLines([conv], { ...opts, format: "rewards", pick: "all" }).lines[0]!).reward).toBe(0.75);
    expect(datasetLines([conv], { ...opts, format: "chat", pick: "good" }).kept).toBe(1);
    expect(datasetLines([{ ...conv, rewards: { run_a_1: 0, run_b_2: null } }], { ...opts, format: "chat", pick: "good" }).kept).toBe(0);
    const sg = JSON.parse(datasetLines([conv], { ...opts, format: "sharegpt", pick: "all" }).lines[0]!);
    expect(sg.conversations.map((t: { from: string }) => t.from)).toEqual(["system", "human", "gpt", "tool", "gpt", "human", "gpt", "tool", "gpt"]);
    expect(sg.conversations[2].value).toBe("<tool_call>\n{\"name\":\"image_generate\",\"arguments\":{\"prompt\":\"sourdough loaf, morning light\"}}\n</tool_call>");
    expect(sg.conversations[3].value).toContain("<tool_response>\n{\"tool_call_id\":\"call_1\",\"name\":\"image_generate\",\"content\":{\"success\":true,\"image\":\"cache/1.png\"}}\n</tool_response>");
    expect(sg).toMatchObject({ completed: true, model: "m", reward: 0.75 });
  });

  it("count thumbs, rewards and conversations good enough to train on", () => {
    const runs = [summary("run_a_1"), summary("run_b_2", { startedAt: 2 })];
    const convs = conversationsOf(runs).map((rs) => ({ runs: rs, events: {}, rewards: { run_a_1: 1, run_b_2: 0 } }));
    expect(agentStats(convs, { run_a_1: { score: 1, at: 0 }, run_b_2: { score: 0, at: 0 } })).toEqual({ conversations: 2, up: 1, down: 1, reward: 0.5, good: 1 });
    expect(toShareGpt([{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }])).toEqual([{ from: "human", value: "hi" }, { from: "gpt", value: "hello" }]);
  });
});
