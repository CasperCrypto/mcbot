import { describe, expect, it } from "vitest";
import { ModelDataSchema, type ModelNode } from "../src/contracts/graph";
import type { RunSummary } from "../src/contracts/run";
import { buildCostReport, priceSession } from "./cost";
import type { SessionRow } from "./hermesData";

const model = (name: string, endpoint: "local" | "cloud", baseUrl: string, id: string, pricing: ModelNode["data"]["pricing"]): ModelNode => ({
  id: `m-${name}`, kind: "model", position: { x: 0, y: 0 },
  data: ModelDataSchema.parse({ name, endpoint, baseUrl, model: id, apiKeyEnv: endpoint === "cloud" ? "K" : "", pricing }),
});
const session = (over: Partial<SessionRow>): SessionRow => ({
  id: "s", source: "oneshot", model: "m", billingProvider: "custom", billingBaseUrl: "http://127.0.0.1:1/v1", startedAt: 1793750000,
  endedAt: null, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, apiCalls: 1,
  toolCalls: 0, messages: 2, estimatedCostUsd: 0, actualCostUsd: null, costStatus: "unknown", title: null, ...over,
});
const run = (over: Partial<RunSummary>): RunSummary => ({
  runId: "r", boardId: "b", agentNodeId: "a", profile: "triage", prompt: "", status: "succeeded", startedAt: 0, finishedAt: 2000,
  sessionId: null, model: null, text: "", tokens: null, toolCalls: 0, toolErrors: 0, error: null, reportedUsd: null, estimatedUsd: null, approval: null, ...over,
});

const local = model("local", "local", "http://127.0.0.1:1/v1", "m", { inputPerMTok: 1, outputPerMTok: 2 });
const cloud = model("cloud", "cloud", "https://api.example.com/v1", "big", null);

describe("priceSession", () => {
  it("trusts Hermes when it priced the session", () => {
    expect(priceSession(session({ costStatus: "estimated", estimatedCostUsd: 0.42 }), [local])).toEqual({ usd: 0.42, source: "hermes" });
  });
  it("estimates from model-node pricing when Hermes reports cost_status unknown", () => {
    expect(priceSession(session({ inputTokens: 1_000_000, outputTokens: 500_000 }), [local])).toEqual({ usd: 2, source: "estimate" });
  });
  it("says so when nothing priced it", () => {
    expect(priceSession(session({ billingBaseUrl: "https://api.example.com/v1/", model: "big" }), [cloud])).toEqual({ usd: 0, source: "none" });
  });
});

describe("buildCostReport", () => {
  it("rolls up by agent, model and day and computes cost per successful run", () => {
    const report = buildCostReport(
      [{ profile: "triage", agentNodeId: "a", sessions: [
        session({ id: "s1", inputTokens: 1_000_000, outputTokens: 0, startedAt: 1793750000 }),
        session({ id: "s2", inputTokens: 1_000_000, outputTokens: 0, startedAt: 1793836400 }),
        session({ id: "s3", inputTokens: 500, outputTokens: 5 }),
      ] }],
      [run({ runId: "r1", sessionId: "s1", status: "succeeded" }), run({ runId: "r2", sessionId: "s2", status: "failed" })],
      [local],
    );
    expect(report.totals).toEqual({ sessions: 3, inputTokens: 2_000_500, outputTokens: 5, usd: expect.closeTo(2.00051, 6), runs: 2, successfulRuns: 1 });
    expect(report.costPerSuccessfulRun).toBeCloseTo(2, 6);
    expect(report.byAgent.map((r) => [r.key, r.sessions, r.source])).toEqual([["triage", 3, "estimate"]]);
    expect(report.byDay.map((r) => r.key)).toEqual(["2026-11-04", "2026-11-03"]);
    expect(report.localInferenceSeconds).toBe(4);
    expect(report.sessions.find((s) => s.id === "s2")).toMatchObject({ runId: "r2", runStatus: "failed" });
  });
});
