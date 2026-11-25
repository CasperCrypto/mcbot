/**
 * Versions of a harness: each compile that changes what the agents are (blocks and wires, never
 * where they sit, notes, frames or chat) keeps the board as it was compiled, with what changed in
 * words. Runs are counted against the version that was live when they started, so two versions can
 * be compared on what they did: how many runs succeeded, what a run cost, how long it took.
 * Pure: the engine and the browser demo store them, the Board's History panel shows them.
 */
import { CAPABILITIES, type Graph, type GraphEdge, type GraphNode } from "../contracts/graph";
import type { RunSummary } from "../contracts/run";
import { modelName } from "../app/lib/modelName";

export interface HarnessVersion {
  id: string;
  /** When it was compiled (ms). */
  at: number;
  /** harnessHash of its graph. */
  hash: string;
  /** A name the person gave it ("cheaper researcher"); null = none. */
  name: string | null;
  /** What changed since the version before, in words. */
  changes: string[];
  /** The board as compiled: blocks and wires (notes, frames and chat left out). */
  graph: Graph;
}

/** Versions kept per board (named ones are always kept). */
export const KEEP_VERSIONS = 60;

/** Keys in a stable order, so equal data is equal text. */
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]));
  return v;
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** What makes the harness, as text: blocks (kind and settings) and wires; no positions, notes or chat. */
export function harnessText(g: Graph): string {
  return JSON.stringify({
    nodes: [...g.nodes].sort(byId).map((n) => ({ id: n.id, kind: n.kind, data: stable(n.data) })),
    edges: [...g.edges].sort(byId).map((e) => ({ id: e.id, s: e.source, t: e.target, o: e.order })),
  });
}

/** FNV-1a, twice with different seeds: a 64-bit hex fingerprint of the harness (not for security). */
export function harnessHash(g: Graph): string {
  const text = harnessText(g);
  const fnv = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  return fnv(0x811c9dc5) + fnv(0x01000193 ^ 0x5bd1e995);
}

/** The board without what never makes the harness: notes, frames and chat. */
export function harnessOnly(g: Graph): Graph {
  return { schema: g.schema, id: g.id, name: g.name, nodes: g.nodes, edges: g.edges };
}

const nameOf = (n: GraphNode): string => (n.kind === "agent" ? n.data.displayName || n.data.name : n.kind === "model" ? modelName(n.data.model) || n.data.label || n.data.name : n.data.label || n.data.name);
const KIND: Record<GraphNode["kind"], string> = { agent: "agent", model: "model", tool: "tool", media: "maker", channel: "chat app" };
const ability = (k: string) => CAPABILITIES.find((c) => c.key === k)?.label ?? k;
const same = (a: unknown, b: unknown) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

/** How one block changed, in words ("Researcher: thinking off → deep"). */
function nodeChanges(a: GraphNode, b: GraphNode): string[] {
  const n = nameOf(b);
  const out: string[] = [];
  if (a.kind === "agent" && b.kind === "agent") {
    const x = a.data;
    const y = b.data;
    if (x.name !== y.name) out.push(`${n}: profile renamed ${x.name} → ${y.name}`);
    if (x.soul !== y.soul) out.push(`${n}: new personality`);
    if (x.description !== y.description) out.push(`${n}: says it does something new`);
    if ((x.maxSteps ?? null) !== (y.maxSteps ?? null)) out.push(`${n}: steps per message ${x.maxSteps ?? "any"} → ${y.maxSteps ?? "any"}`);
    if ((x.reasoning ?? null) !== (y.reasoning ?? null)) out.push(`${n}: thinking ${x.reasoning ?? "default"} → ${y.reasoning ?? "default"}`);
    if ((x.approvals ?? "smart") !== (y.approvals ?? "smart")) out.push(`${n}: approvals ${x.approvals ?? "smart"} → ${y.approvals ?? "smart"}`);
    if ((x.dailyBudgetUsd ?? null) !== (y.dailyBudgetUsd ?? null)) out.push(`${n}: daily budget ${x.dailyBudgetUsd ? `$${x.dailyBudgetUsd}` : "none"} → ${y.dailyBudgetUsd ? `$${y.dailyBudgetUsd}` : "none"}`);
    if ((x.builtinSkills ?? true) !== (y.builtinSkills ?? true)) out.push(`${n}: Hermes' built-in skills ${y.builtinSkills === false ? "off" : "on"}`);
    if (!same(x.skills, y.skills)) out.push(`${n}: its own skills changed (${y.skills.length})`);
    if (!same(x.browser ?? null, y.browser ?? null)) out.push(`${n}: browser settings changed`);
    if (!same(x.capabilities, y.capabilities)) {
      const before = new Set(x.capabilities ?? []);
      const after = new Set(y.capabilities ?? []);
      if (x.capabilities === null || y.capabilities === null) out.push(`${n}: abilities ${y.capabilities === null ? "back to Hermes' default" : "chosen by hand"}`);
      else {
        const added = [...after].filter((k) => !before.has(k)).map((k) => `+${ability(k)}`);
        const removed = [...before].filter((k) => !after.has(k)).map((k) => `−${ability(k)}`);
        out.push(`${n}: abilities ${[...added, ...removed].join(", ")}`);
      }
    }
    return out;
  }
  if (a.kind === "model" && b.kind === "model") {
    if (a.data.model !== b.data.model) out.push(`Model ${modelName(a.data.model) || "none"} → ${modelName(b.data.model) || "none"}`);
    if (a.data.baseUrl !== b.data.baseUrl) out.push(`${n}: served from somewhere else`);
    if (!same(a.data.pricing ?? null, b.data.pricing ?? null)) out.push(`${n}: new price`);
    return out;
  }
  if (a.kind === "tool" && b.kind === "tool") {
    const x = a.data.toolsInclude ?? [];
    const y = b.data.toolsInclude ?? [];
    if (!same(x, y)) out.push(y.length ? `${n}: only ${y.length} of its tools` : `${n}: all of its tools`);
    if (a.data.url !== b.data.url || a.data.command !== b.data.command || !same(a.data.args, b.data.args)) out.push(`${n}: connects differently`);
    return out;
  }
  if (!same(a.data, b.data)) out.push(`${n}: settings changed`);
  return out;
}

/** A wire in words, from the agent's side: "Researcher thinks with Claude Sonnet 4.5". */
function wireWords(e: GraphEdge, nodes: Map<string, GraphNode>): { key: string; text: string; gone: string } | null {
  const s = nodes.get(e.source);
  const t = nodes.get(e.target);
  if (!s || !t) return null;
  if (s.kind === "agent" && t.kind === "agent") return { key: `hand ${s.id} ${t.id}`, text: `${nameOf(s)} hands work to ${nameOf(t)}`, gone: `${nameOf(s)} no longer hands work to ${nameOf(t)}` };
  const agent = s.kind === "agent" ? s : t.kind === "agent" ? t : null;
  const other = agent === s ? t : s;
  if (!agent) return null;
  const a = nameOf(agent);
  const o = nameOf(other);
  if (other.kind === "model") {
    const main = e.order === 0;
    return { key: `model ${agent.id} ${other.id} ${main ? "main" : "backup"}`, text: main ? `${a} thinks with ${o}` : `${a} falls back to ${o}`, gone: `${a} no longer ${main ? "thinks with" : "falls back to"} ${o}` };
  }
  const verb = other.kind === "channel" ? "answers on" : other.kind === "media" ? "makes with" : "uses";
  return { key: `${other.kind} ${agent.id} ${other.id}`, text: `${a} ${verb} ${o}`, gone: `${a} no longer ${verb} ${o}` };
}

/** What changed from `a` to `b`, in words; the first version describes itself. */
export function describeChanges(a: Graph | null, b: Graph): string[] {
  const agents = b.nodes.filter((n) => n.kind === "agent").length;
  if (!a) return [`First version: ${agents} agent${agents === 1 ? "" : "s"}, ${b.nodes.length - agents} block${b.nodes.length - agents === 1 ? "" : "s"}`];
  const before = new Map(a.nodes.map((n) => [n.id, n]));
  const after = new Map(b.nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  for (const n of b.nodes) if (!before.has(n.id)) out.push(`Added ${KIND[n.kind]} ${nameOf(n)}`);
  for (const n of a.nodes) if (!after.has(n.id)) out.push(`Removed ${KIND[n.kind]} ${nameOf(n)}`);
  for (const n of b.nodes) {
    const old = before.get(n.id);
    if (old) out.push(...nodeChanges(old, n));
  }
  const wires = (g: Graph, nodes: Map<string, GraphNode>) => new Map(g.edges.flatMap((e) => { const w = wireWords(e, nodes); return w ? [[w.key, w] as const] : []; }));
  const was = wires(a, before);
  const now = wires(b, after);
  for (const [k, w] of now) if (!was.has(k)) out.push(w.text);
  for (const [k, w] of was) if (!now.has(k) && (after.has(k.split(" ")[1] ?? "") || k.startsWith("hand"))) out.push(w.gone);
  return out.length ? out : ["Same blocks; settings only Hermes reads changed"];
}

/**
 * The versions after a compile of `graph`: unchanged when the harness is the same as the last one,
 * else a new version at the end. Keeps the newest KEEP_VERSIONS and every named one.
 */
export function addVersion(list: readonly HarnessVersion[], graph: Graph, now: number): HarnessVersion[] {
  const hash = harnessHash(graph);
  const last = list.at(-1);
  if (last?.hash === hash) return [...list];
  const next: HarnessVersion = { id: `${now.toString(36)}-${hash.slice(0, 6)}`, at: now, hash, name: null, changes: describeChanges(last?.graph ?? null, graph), graph: harnessOnly(graph) };
  const all = [...list, next];
  const cut = all.length - KEEP_VERSIONS;
  return cut > 0 ? all.filter((v, i) => i >= cut || v.name) : all;
}

export interface VersionStats {
  runs: number;
  succeeded: number;
  failed: number;
  /** Mean of runs that report a price (Hermes' or McBot's estimate); null when none do. */
  usdPerRun: number | null;
  /** Mean wall-clock time of finished runs (ms); null when none finished. */
  msPerRun: number | null;
  /** Mean tokens (in + out) of runs that report them; null when none do. */
  tokensPerRun: number | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Each version's runs: those that started while it was the live version (until the next one). */
export function versionStats(versions: readonly HarnessVersion[], runs: readonly RunSummary[]): Map<string, VersionStats> {
  const sorted = [...versions].sort((a, b) => a.at - b.at);
  const out = new Map<string, VersionStats>();
  sorted.forEach((v, i) => {
    const until = sorted[i + 1]?.at ?? Infinity;
    const mine = runs.filter((r) => r.startedAt >= v.at && r.startedAt < until && r.status !== "running" && r.status !== "queued");
    out.set(v.id, {
      runs: mine.length,
      succeeded: mine.filter((r) => r.status === "succeeded").length,
      failed: mine.filter((r) => r.status === "failed").length,
      usdPerRun: mean(mine.flatMap((r) => { const usd = r.reportedUsd ?? r.estimatedUsd; return usd === null ? [] : [usd]; })),
      msPerRun: mean(mine.flatMap((r) => (r.finishedAt ? [r.finishedAt - r.startedAt] : []))),
      tokensPerRun: mean(mine.flatMap((r) => (r.tokens ? [r.tokens.input + r.tokens.output] : []))),
    });
  });
  return out;
}
