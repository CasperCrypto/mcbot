/**
 * Cost from real data: Hermes' per-session rows in each profile's state.db,
 * joined to McBot's run records. Hermes prices known providers itself
 * (estimated_cost_usd with a cost_status); for custom/local endpoints it
 * records cost_status "unknown", and McBot falls back to the model node's
 * pricing, labelled as an estimate.
 */
import type { BudgetStatus, CostReport, CostRow, CostSession, CostSource } from "../src/contracts/api";
import type { ModelNode } from "../src/contracts/graph";
import type { RunSummary } from "../src/contracts/run";
import type { SessionRow } from "./hermesData";

export interface ProfileSessions {
  profile: string;
  agentNodeId: string | null;
  sessions: SessionRow[];
  /** The agent's daily budget in USD, when it has one. */
  dailyBudgetUsd?: number | null;
}

const norm = (u: string | null) => (u ?? "").trim().replace(/\/+$/, "").toLowerCase();

export function priceSession(s: SessionRow, models: readonly ModelNode[]): { usd: number; source: CostSource } {
  if (s.costStatus && s.costStatus !== "unknown" && s.estimatedCostUsd !== null) return { usd: s.actualCostUsd ?? s.estimatedCostUsd, source: "hermes" };
  const node = models.find((m) => norm(m.data.baseUrl) === norm(s.billingBaseUrl) && m.data.model === s.model)
    ?? models.find((m) => norm(m.data.baseUrl) === norm(s.billingBaseUrl));
  const p = node?.data.pricing;
  if (!p) return { usd: 0, source: "none" };
  return { usd: (s.inputTokens * p.inputPerMTok + s.outputTokens * p.outputPerMTok) / 1_000_000, source: "estimate" };
}

function combine(a: CostSource, b: CostSource): CostSource {
  if (a === b) return a;
  if (a === "estimate" || b === "estimate") return "estimate";
  return a === "none" ? b : a;
}

function rollup(sessions: readonly CostSession[], keyOf: (s: CostSession) => string, labelOf: (s: CostSession) => string): CostRow[] {
  const rows = new Map<string, CostRow>();
  for (const s of sessions) {
    const key = keyOf(s);
    const row = rows.get(key) ?? { key, label: labelOf(s), sessions: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, usd: 0, source: s.source };
    row.sessions += 1;
    row.inputTokens += s.inputTokens;
    row.outputTokens += s.outputTokens;
    row.cacheReadTokens += s.cacheReadTokens;
    row.usd += s.usd;
    row.source = combine(row.source, s.source);
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.usd - a.usd || b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens) || (a.key < b.key ? -1 : 1));
}

const day = (epochSeconds: number) => new Date(epochSeconds * 1000).toISOString().slice(0, 10);

export function buildCostReport(profiles: readonly ProfileSessions[], runs: readonly RunSummary[], models: readonly ModelNode[], nowMs: number = Date.now()): CostReport {
  const runBySession = new Map(runs.filter((r) => r.sessionId).map((r) => [r.sessionId!, r]));
  const localUrls = new Set(models.filter((m) => m.data.endpoint === "local").map((m) => norm(m.data.baseUrl)));

  const sessions: CostSession[] = profiles.flatMap((p) =>
    p.sessions.map((s) => {
      const { usd, source } = priceSession(s, models);
      const run = runBySession.get(s.id) ?? null;
      return {
        id: s.id,
        profile: p.profile,
        agentNodeId: p.agentNodeId,
        model: s.model,
        baseUrl: s.billingBaseUrl,
        startedAt: s.startedAt,
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
        cacheReadTokens: s.cacheReadTokens,
        usd,
        source,
        costStatus: s.costStatus,
        runId: run?.runId ?? null,
        runStatus: run?.status ?? null,
      };
    }),
  ).sort((a, b) => b.startedAt - a.startedAt);

  const finished = runs.filter((r) => r.status !== "running" && r.status !== "queued");
  const successful = finished.filter((r) => r.status === "succeeded");
  const runSpend = sessions.filter((s) => s.runId).reduce((sum, s) => sum + s.usd, 0);
  const localInferenceSeconds = finished.reduce((sum, r) => {
    const s = sessions.find((x) => x.runId === r.runId);
    return s && localUrls.has(norm(s.baseUrl)) && r.finishedAt ? sum + (r.finishedAt - r.startedAt) / 1000 : sum;
  }, 0);

  const today = day(nowMs / 1000);
  const budgets: BudgetStatus[] = profiles.flatMap((p): BudgetStatus[] => {
    if (!p.dailyBudgetUsd || p.dailyBudgetUsd <= 0) return [];
    const mine = sessions.filter((s) => s.profile === p.profile && day(s.startedAt) === today);
    const spent = mine.reduce((n, s) => n + s.usd, 0);
    const ratio = spent / p.dailyBudgetUsd;
    return [{
      profile: p.profile, agentNodeId: p.agentNodeId, limitUsd: p.dailyBudgetUsd, spentTodayUsd: spent,
      state: ratio >= 1 ? "over" : ratio >= 0.8 ? "warn" : "ok", unpriced: mine.some((s) => s.source === "none"),
    }];
  }).sort((a, b) => b.spentTodayUsd / b.limitUsd - a.spentTodayUsd / a.limitUsd || (a.profile < b.profile ? -1 : 1));

  return {
    totals: {
      sessions: sessions.length,
      inputTokens: sessions.reduce((n, s) => n + s.inputTokens, 0),
      outputTokens: sessions.reduce((n, s) => n + s.outputTokens, 0),
      usd: sessions.reduce((n, s) => n + s.usd, 0),
      runs: finished.length,
      successfulRuns: successful.length,
    },
    costPerSuccessfulRun: successful.length ? runSpend / successful.length : null,
    localInferenceSeconds: Math.round(localInferenceSeconds * 10) / 10,
    budgets,
    byAgent: rollup(sessions, (s) => s.profile, (s) => s.profile),
    byModel: rollup(sessions, (s) => `${s.model ?? "?"}@${norm(s.baseUrl)}`, (s) => s.model ?? "unknown model"),
    byDay: rollup(sessions, (s) => day(s.startedAt), (s) => day(s.startedAt)).sort((a, b) => (a.key < b.key ? 1 : -1)),
    sessions,
  };
}
