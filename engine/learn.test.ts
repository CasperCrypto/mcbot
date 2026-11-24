import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { RunEvent, RunSummary } from "../src/contracts/run";
import { Ratings, writeDataset } from "./learn";

const dir = mkdtempSync(join(tmpdir(), "mcbot-learn-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const ev = (runId: string, text: string): RunEvent[] => [
  { v: 1, runId, seq: 0, ts: 0, type: "run.started", boardId: "b", agentNodeId: "a", profile: "writer", prompt: "Write our post", argv: [], hermesHome: "/h", cwd: "/c" },
  { v: 1, runId, seq: 1, ts: 0, type: "run.text", text },
];
const run = (runId: string): RunSummary => ({ runId, boardId: "b", agentNodeId: "a", profile: "writer", prompt: "Write our post", status: "succeeded", startedAt: 1, finishedAt: 2, sessionId: null, model: "m", text: "", tokens: null, toolCalls: 0, toolErrors: 0, error: null, reportedUsd: null, estimatedUsd: null, approval: null });

describe("Learn in the engine", () => {
  it("keeps ratings across restarts and takes one off on null", async () => {
    const file = join(dir, "ratings.json");
    const r = new Ratings(file);
    await r.set("run_a_1", { score: 1, at: 5 });
    await Promise.all([r.set("run_b_2", { score: 0, at: 6 }), r.set("run_c_3", { score: 1, at: 7 })]);
    await r.set("run_c_3", null);
    expect(await new Ratings(file).all()).toEqual({ run_a_1: { score: 1, at: 5 }, run_b_2: { score: 0, at: 6 } });
  });

  it("writes a dataset without saved keys or tokens, never over an earlier file", async () => {
    const convs = [{ runs: [run("run_a_1")], events: { run_a_1: ev("run_a_1", "Our key is sk-supersecretvalue123 and token ghp_abcdefghijklmnopqrstuvwxyz012345") }, rewards: { run_a_1: 1 } }];
    const opts = { profile: "writer", convs, format: "chat" as const, pick: "all" as const, system: "You write posts.", model: "m", secrets: ["sk-supersecretvalue123"], now: new Date(2026, 10, 24, 9, 5) };
    const first = await writeDataset(join(dir, "datasets"), opts);
    const second = await writeDataset(join(dir, "datasets"), opts);
    expect(first.file).toBe("writer-chat-20261124-0905.jsonl");
    expect(second.file).toBe("writer-chat-20261124-0905-2.jsonl");
    expect(first.examples).toBe(1);
    const text = readFileSync(first.path, "utf8");
    expect(text).not.toContain("sk-supersecretvalue123");
    expect(text).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz012345");
    expect(JSON.parse(text.trim()).messages[0]).toEqual({ role: "system", content: "You write posts." });
  });
});
