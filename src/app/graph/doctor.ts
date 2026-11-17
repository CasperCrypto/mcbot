/**
 * Harness doctor: everything about the board that would make it fail, cost money unseen, or do
 * nothing, each with the one action that fixes it. Pure: the sheet (DoctorSheet.tsx) passes in
 * what the engine knows (saved key names, local servers' health, files that differ from disk).
 */
import { resolveGraph } from "../../compile";
import type { Graph, GraphNode } from "../../contracts/graph";
import { agentsOf, agentsWithoutModel, modelsOf, type ModelHealth } from "../lib/models";

export type Fix =
  | { kind: "select"; nodeId: string; label: string }
  | { kind: "settings"; page: "models" | "keys" | "engine"; label: string }
  | { kind: "compile"; label: string }
  | { kind: "delete"; nodeId: string; label: string };

export interface Finding {
  id: string;
  /** error: it won't run · warn: it runs badly or unseen · tip: worth a look. */
  level: "error" | "warn" | "tip";
  title: string;
  sub: string;
  nodeId?: string;
  fix: Fix;
}

export interface DoctorContext {
  /** Names of saved keys; null while unknown (no key findings then). */
  keys: readonly string[] | null;
  health: Readonly<Record<string, ModelHealth>>;
  /** Files on disk that differ from the board (dry-run compile), null while unknown. */
  drift: number | null;
  engineReady: boolean | null;
}

const title = (n: GraphNode) => String(("displayName" in n.data && n.data.displayName) || ("label" in n.data && n.data.label) || n.data.name || n.kind);
const RANK = { error: 0, warn: 1, tip: 2 } as const;

export function checkHarness(g: Graph, ctx: DoctorContext): Finding[] {
  const out: Finding[] = [];
  if (ctx.engineReady === false) out.push({ id: "engine", level: "error", title: "The engine isn't ready", sub: "Agents can't run until it is prepared", fix: { kind: "settings", page: "engine", label: "Prepare" } });

  // What the compiler refuses: the board can't become files.
  for (const [i, issue] of resolveGraph(g).issues.entries()) {
    // "has no model" gets its own finding below, with the fix that adds one.
    if (issue.level !== "error" || / has no model;/.test(issue.message)) continue;
    out.push({ id: `issue-${i}`, level: "error", title: issue.message, sub: "Compile stops here", nodeId: issue.nodeId ?? undefined, fix: issue.nodeId ? { kind: "select", nodeId: issue.nodeId, label: "Show" } : { kind: "compile", label: "Compile" } });
  }

  for (const a of agentsWithoutModel(g)) out.push({ id: `no-model-${a.id}`, level: "error", title: `${title(a)} has no model`, sub: "An agent needs a model to think with", nodeId: a.id, fix: { kind: "settings", page: "models", label: "Add model" } });

  const wired = new Set(g.edges.flatMap((e) => [e.source, e.target]));
  const agentIds = new Set(agentsOf(g).map((a) => a.id));
  const toAgent = (id: string) => g.edges.some((e) => (e.source === id && agentIds.has(e.target)) || (e.target === id && agentIds.has(e.source)));

  for (const m of modelsOf(g)) {
    const d = m.data;
    if (d.endpoint === "cloud" && d.apiKeyEnv && toAgent(m.id) && ctx.keys && !ctx.keys.includes(d.apiKeyEnv)) out.push({ id: `key-${m.id}`, level: "error", title: `${d.apiKeyEnv} isn't saved`, sub: `${title(m)} can't answer without it`, nodeId: m.id, fix: { kind: "settings", page: "keys", label: "Add key" } });
    const h = ctx.health[m.id];
    if (d.endpoint === "local" && toAgent(m.id) && (h === "down" || h === "missing")) out.push({ id: `down-${m.id}`, level: "warn", title: h === "down" ? `${title(m)} isn't answering` : `${title(m)} doesn't have ${d.model}`, sub: h === "down" ? `Nothing at ${d.baseUrl}` : "Pull the model, or pick one the server has", nodeId: m.id, fix: { kind: "settings", page: "models", label: "Fix" } });
    if (d.endpoint === "cloud" && !d.pricing && toAgent(m.id)) out.push({ id: `price-${m.id}`, level: "tip", title: `${title(m)} has no price`, sub: "Its spend shows as $0 and budgets can't see it", nodeId: m.id, fix: { kind: "select", nodeId: m.id, label: "Set price" } });
  }

  for (const n of g.nodes) {
    if (n.kind === "agent") continue;
    if (!wired.has(n.id) || !toAgent(n.id)) out.push({ id: `alone-${n.id}`, level: "tip", title: `${title(n)} isn't wired to an agent`, sub: "It compiles into nothing", nodeId: n.id, fix: { kind: "delete", nodeId: n.id, label: "Remove" } });
    if (n.kind === "channel" && n.data.allowedUsers.length === 0 && toAgent(n.id)) out.push({ id: `nobody-${n.id}`, level: "warn", title: `Nobody may message ${title(n)}`, sub: "Hermes refuses senders it doesn't know", nodeId: n.id, fix: { kind: "select", nodeId: n.id, label: "Add people" } });
  }

  // Spending with no cap: agents on a paid model with no daily budget.
  const paid = new Set(modelsOf(g).filter((m) => m.data.endpoint === "cloud").map((m) => m.id));
  for (const a of agentsOf(g)) {
    if (a.data.dailyBudgetUsd) continue;
    if (g.edges.some((e) => e.target === a.id && paid.has(e.source))) out.push({ id: `budget-${a.id}`, level: "tip", title: `${title(a)} has no daily budget`, sub: "It uses a paid model with no cap", nodeId: a.id, fix: { kind: "select", nodeId: a.id, label: "Set budget" } });
  }

  if (ctx.drift) out.push({ id: "drift", level: "warn", title: `${ctx.drift} file${ctx.drift > 1 ? "s" : ""} differ from the board`, sub: "Agents run what was last compiled", fix: { kind: "compile", label: "Compile" } });

  return out.sort((a, b) => RANK[a.level] - RANK[b.level]);
}
