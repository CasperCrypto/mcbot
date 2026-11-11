/**
 * The browser demo's engine: the same API as engine/server.ts, served inside
 * the page. Compile is the real compiler writing to an in-memory disk; runs are
 * simulated (no Hermes, no model), clearly labelled as such in the UI.
 * Built only with VITE_MCBOT_DEMO=1 (`npm run build:demo`).
 */
import { createTwoFilesPatch } from "diff";
import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import { buildCostReport } from "../../../engine/cost";
import type { SessionRow } from "../../../engine/hermesData";
import { graphFromDoc, loadGraphIntoDoc } from "../../board/ydoc";
import { compile, mcpToolPrefix, PROFILE_DIRS, resolveGraph, type AgentBundle } from "../../compile/index";
import { sha256Hex, utf8Bytes } from "../../compile/text";
import type { AgentMemoryView, BoardInfo, CompileResponse, CostReport, Diagnostics, FsEntry, FsListing, FsPreview, FsRoot, Health, HermesInfo, MemoryFileView, SetupDetect, SetupProfile, SetupState } from "../../contracts/api";
import upstream from "../../../hermes/UPSTREAM.json";
import { MANIFEST_PATH, type FileChange, type Manifest } from "../../contracts/compile";
import type { Graph } from "../../contracts/graph";
import { RUN_EVENT_VERSION, summarizeRun, type RunEvent, type RunEventInput, type RunSummary } from "../../contracts/run";
import { EngineError } from "../lib/engineError";
import { ROOT, SEED_BOARD, WORKSPACE, sampleProject, seedGraph, seedMemory, seedRuns, sharedFiles } from "./seed";

type Target = "memory" | "user";
const LIMITS: Record<Target, number> = { memory: 2200, user: 1375 };
const DELIM = "\n§\n";
const STATE_KEY = "mcbot.demo.v1";
const boardKey = (id: string) => `mcbot.demo.board.${id}`;
const SAMPLE_FOLDER: FsRoot = { id: "folder:sample", kind: "folder", name: "acme-support", path: "/Users/you/Projects/acme-support" };

interface State {
  boards: BoardInfo[];
  /** The compile output root: path relative to ROOT → content. */
  disk: Record<string, string>;
  runs: Record<string, RunEvent[]>;
  memory: Record<string, Record<Target, string[]>>;
  sessions: Record<string, SessionRow[]>;
  sampleOpen: boolean;
  /** Setup assistant: done or not, and boards it built (their graphs until a window opens them). */
  setup?: SetupState;
  pending?: Record<string, Graph>;
}

// ---------- storage (best effort: a private window just starts fresh) ----------

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* not persisted */
    }
  },
};
const toB64 = (u: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

let state: State;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function save(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.set(STATE_KEY, JSON.stringify(state)), 250);
}

// ---------- boards: one Y.Doc per board, shared between tabs over BroadcastChannel ----------

const docs = new Map<string, Y.Doc>();

function fillDoc(doc: Y.Doc, boardId: string): void {
  const saved = store.get(boardKey(boardId));
  if (saved) {
    try {
      Y.applyUpdate(doc, fromB64(saved));
      return;
    } catch {
      /* corrupt: fall through to the seed */
    }
  }
  const name = state.boards.find((b) => b.id === boardId)?.name ?? "Board";
  const built = state.pending?.[boardId];
  loadGraphIntoDoc(doc, boardId === SEED_BOARD.id ? seedGraph : built ? { ...built, id: boardId, name } : { schema: "mcbot.graph/v1", id: boardId, name, nodes: [], edges: [] });
}

function graphOf(boardId: string): Graph {
  const open = docs.get(boardId);
  if (open) return graphFromDoc(open);
  const doc = new Y.Doc();
  fillDoc(doc, boardId);
  const g = graphFromDoc(doc);
  doc.destroy();
  return g;
}

type SyncListener = (synced: boolean) => void;
/** What board.tsx needs from a connection; y-websocket's provider has the same shape. */
export interface DemoLink {
  awareness: Awareness;
  synced: boolean;
  on(event: "sync", f: SyncListener): void;
  off(event: "sync", f: SyncListener): void;
  destroy(): void;
}

export function connectDemoBoard(boardId: string, doc: Y.Doc): DemoLink {
  fillDoc(doc, boardId);
  docs.set(boardId, doc);
  const awareness = new Awareness(doc);
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(`mcbot-demo-${boardId}`);
  } catch {
    channel = null;
  }
  const remote = {};
  let persist: ReturnType<typeof setTimeout> | null = null;
  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin !== remote) channel?.postMessage({ t: "u", u: update });
    if (persist) clearTimeout(persist);
    persist = setTimeout(() => store.set(boardKey(boardId), toB64(Y.encodeStateAsUpdate(doc))), 300);
  };
  const onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin !== remote) channel?.postMessage({ t: "a", u: encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]) });
  };
  doc.on("update", onUpdate);
  awareness.on("update", onAwareness);
  if (channel) {
    channel.onmessage = (m: MessageEvent<{ t: string; u?: Uint8Array; sv?: Uint8Array }>) => {
      const { t, u, sv } = m.data;
      if (t === "u" && u) Y.applyUpdate(doc, u, remote);
      else if (t === "a" && u) applyAwarenessUpdate(awareness, u, remote);
      else if (t === "hello") {
        channel!.postMessage({ t: "u", u: Y.encodeStateAsUpdate(doc, sv) });
        channel!.postMessage({ t: "a", u: encodeAwarenessUpdate(awareness, [...awareness.getStates().keys()]) });
      }
    };
    channel.postMessage({ t: "hello", sv: Y.encodeStateVector(doc) });
  }
  return {
    awareness,
    synced: true,
    on: () => undefined,
    off: () => undefined,
    destroy() {
      removeAwarenessStates(awareness, [doc.clientID], "destroy");
      doc.off("update", onUpdate);
      awareness.off("update", onAwareness);
      awareness.destroy();
      channel?.close();
      if (docs.get(boardId) === doc) docs.delete(boardId);
    },
  };
}

// ---------- compile: the real compiler, an in-memory disk ----------

function unifiedDiff(path: string, before: string, after: string): string {
  return before === after ? "" : createTwoFilesPatch(`a/${path}`, `b/${path}`, before, after, "", "", { context: 3 });
}

function manifest(): Manifest | null {
  const raw = state.disk[MANIFEST_PATH];
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Manifest;
  } catch {
    return null;
  }
}

function compileBoard(boardId: string, dryRun: boolean): CompileResponse {
  const graph = graphOf(boardId);
  const { issues } = resolveGraph(graph);
  if (issues.some((i) => i.level === "error")) return { ok: false, issues, error: "The board has errors" };
  const result = compile(graph);
  const next = new Set(result.files.map((f) => f.path));
  const changes: FileChange[] = result.files.map((f) => {
    const before = state.disk[f.path] ?? null;
    const prev = before === null ? null : sha256Hex(before);
    return {
      path: f.path, status: before === null ? "added" : prev === f.sha256 ? "unchanged" : "modified", sha256: f.sha256, previousSha256: prev,
      bytes: f.bytes, role: f.role, nodeId: f.nodeId ?? null, diff: unifiedDiff(f.path, before ?? "", f.content),
    };
  });
  for (const old of manifest()?.files ?? []) {
    const before = state.disk[old.path];
    if (next.has(old.path) || before === undefined) continue;
    changes.push({ path: old.path, status: "removed", sha256: null, previousSha256: sha256Hex(before), bytes: utf8Bytes(before).length, role: null, nodeId: null, diff: unifiedDiff(old.path, before, "") });
  }
  changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const configChanged = changes.some((c) => c.path.endsWith("/config.yaml") && c.status !== "unchanged");
  if (!dryRun) {
    for (const c of changes) if (c.status === "removed") delete state.disk[c.path];
    for (const f of result.files) state.disk[f.path] = f.content;
    save();
  }
  return { ok: true, report: { graphId: result.graphId, root: ROOT, written: !dryRun, profiles: result.profiles, changes }, issues, gateway: !dryRun && configChanged ? "restart-pending" : "unchanged" };
}

// ---------- runs: simulated, in the run event shape (contract 3) ----------

/** Key names typed into the demo's setup. The values are dropped: a browser demo never keeps keys. */
const secretNames = new Set<string>();

type Listener = (e: RunEvent) => void;
const listeners = new Set<Listener>();
const cancelled = new Set<string>();
const busy = new Map<string, number>();

interface Step {
  tool: string;
  input: unknown;
  output: string;
  toolNodeId: string | null;
}

function words(s: string): Set<string> {
  return new Set(s.toLowerCase().match(/[a-z0-9]{5,}/g) ?? []);
}

/** What the simulated agent does for a prompt: deterministic, so the demo is predictable. */
function script(prompt: string, bundle: AgentBundle): { steps: Step[]; text: string } {
  const profile = bundle.agent.data.name;
  const mem = state.memory[profile] ?? { memory: [], user: [] };
  const toolFor = (name: string) => bundle.tools.find((t) => name.startsWith(mcpToolPrefix(t.data.name)))?.id ?? null;
  const filesTool = bundle.tools.find((t) => t.data.transport === "stdio" && t.data.args.some((a) => a.includes("server-filesystem")));

  const remember = /^remember:\s*([\s\S]+)$/i.exec(prompt.trim());
  if (remember) {
    const content = remember[1]!.trim();
    return {
      steps: [{ tool: "memory", input: { action: "add", target: "memory", content }, output: JSON.stringify({ success: true, target: "memory" }), toolNodeId: null }],
      text: `Saved to memory: ${content}`,
    };
  }
  const call = /^call:(\S+)\s*([\s\S]*)$/.exec(prompt.trim());
  if (call) {
    const tool = call[1]!;
    let input: unknown = {};
    try {
      input = call[2]?.trim() ? JSON.parse(call[2]) : {};
    } catch {
      input = call[2];
    }
    const toolNodeId = toolFor(tool);
    if (!toolNodeId) return { steps: [{ tool, input, output: `Unknown tool: ${tool}`, toolNodeId: null }], text: `${tool} is not connected to this agent.` };
    const output = tool.endsWith("list_directory") ? listText(String((input as { path?: string }).path ?? "")) : JSON.stringify({ ok: true });
    return { steps: [{ tool, input, output, toolNodeId }], text: tool.endsWith("list_directory") ? output : "Done." };
  }
  if (/\b2\s*\+\s*2\b/.test(prompt)) return { steps: [], text: "4" };

  const asked = words(prompt);
  const recalled = [...mem.memory, ...mem.user].find((e) => [...words(e)].some((w) => asked.has(w)));
  if (/ticket|file|folder|invoice/i.test(prompt) && filesTool) {
    const tool = `${mcpToolPrefix(filesTool.data.name)}list_directory`;
    const listing = listText("tickets");
    return {
      steps: [{ tool, input: { path: `${WORKSPACE}/files/tickets` }, output: listing, toolNodeId: filesTool.id }],
      text: recalled ? `${recalled} Matching tickets:\n${listing}` : `Open tickets:\n${listing}`,
    };
  }
  if (bundle.agent.data.skills.some((s) => s.name === "route-ticket")) {
    const owner = /invoice|refund|charge|billing|payment/i.test(prompt) ? "Billing → Sam."
      : /down|latency|outage|error|slow/i.test(prompt) ? "Outage → paging the on-call."
      : "Product question → Researcher.";
    return { steps: [], text: recalled && /Sam|on-call/.test(recalled) && !owner.startsWith("Product") ? `${owner} (${recalled})` : owner };
  }
  if (recalled) return { steps: [], text: recalled };
  const docs = bundle.tools.find((t) => t.data.transport === "http");
  if (docs) {
    const hit = Object.entries(sampleProject).find(([p, body]) => p.startsWith("docs/") && [...words(body)].some((w) => asked.has(w)));
    if (hit) {
      return {
        steps: [{ tool: `${mcpToolPrefix(docs.data.name)}search`, input: { query: prompt }, output: hit[0], toolNodeId: docs.id }],
        text: `${hit[1].split("\n").filter((l) => l && !l.startsWith("#")).join(" ")} (${hit[0]})`,
      };
    }
  }
  return { steps: [], text: `Simulated reply from ${bundle.agent.data.displayName || profile}. In the desktop app this prompt goes to ${bundle.models[0]?.data.model ?? "its model"}.` };
}

function listText(path: string): string {
  const clean = path.replace(`${WORKSPACE}/files`, "").replace(/^\/+|\/+$/g, "");
  const entries = listVirtual(sharedFiles, clean);
  return entries.map((e) => `[${e.kind === "dir" ? "DIR" : "FILE"}] ${e.name}`).join("\n") || "(empty)";
}

const newRunId = (ts: number) => `run_${ts.toString(36)}_${Math.random().toString(16).slice(2, 10).padEnd(8, "0")}`;
const sessionIdAt = (ts: number) => `${new Date(ts).toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "_")}_${Math.random().toString(16).slice(2, 8)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Plays one run: emits its events (live, with pauses) or records them at a past
 * time (seed history). Writes memory and a Hermes-like session row like a real run.
 */
async function play(boardId: string, bundle: AgentBundle, prompt: string, opts: { at?: number } = {}): Promise<string> {
  const live = opts.at === undefined;
  const start = opts.at ?? Date.now();
  let clock = start;
  const runId = newRunId(start);
  const profile = bundle.agent.data.name;
  const model = bundle.models[0]!;
  const events: RunEvent[] = (state.runs[runId] = []);
  let seq = 0;
  const emit = (e: RunEventInput) => {
    const ev = { v: RUN_EVENT_VERSION, runId, seq: seq++, ts: live ? Date.now() : clock, ...e } as RunEvent;
    events.push(ev);
    if (live) for (const l of listeners) l(ev);
  };
  const wait = async (ms: number) => {
    if (live) await sleep(ms);
    else clock += ms;
    return cancelled.has(runId);
  };
  const finish = (status: "succeeded" | "interrupted", text: string) => {
    emit({ type: "run.finished", status, exitCode: status === "succeeded" ? 0 : null, text, tokens: null, durationMs: (live ? Date.now() : clock) - start, sessionId: null, error: status === "interrupted" ? "Stopped" : null });
    busy.set(profile, Math.max(0, (busy.get(profile) ?? 1) - 1));
    save();
  };

  busy.set(profile, (busy.get(profile) ?? 0) + 1);
  emit({
    type: "run.started", boardId, agentNodeId: bundle.agent.id, profile, prompt,
    argv: ["hermes", "-p", profile, "chat", "--query-file", "-", "--oneshot", "--format", "stream-json"], hermesHome: ROOT, cwd: `${ROOT}/profiles/${profile}/workspace`,
  });
  const run = async () => {
    if (await wait(450)) return finish("interrupted", "");
    const sessionId = sessionIdAt(start);
    emit({ type: "run.session", sessionId, model: model.data.model });
    const { steps, text } = script(prompt, bundle);
    if (await wait(650)) return finish("interrupted", "");
    for (const s of steps) {
      emit({ type: "run.tool.started", tool: s.tool, input: s.input, toolNodeId: s.toolNodeId });
      const ms = 220 + (s.output.length % 400);
      if (await wait(ms)) return finish("interrupted", "");
      emit({ type: "run.tool.finished", tool: s.tool, output: s.output, durationMs: ms, isError: s.output.startsWith("Unknown tool"), toolNodeId: s.toolNodeId });
      if (s.tool === "memory") remember(profile, String((s.input as { content: string }).content));
    }
    const chunks = text.match(/\S+\s*/g) ?? [text];
    for (let i = 0; i < chunks.length; i += 3) {
      emit({ type: "run.text", text: chunks.slice(i, i + 3).join("") });
      if (await wait(55)) return finish("interrupted", "");
    }
    const soul = bundle.agent.data.soul.length + JSON.stringify(state.memory[profile] ?? {}).length;
    const input = 1650 + Math.round((soul + prompt.length) / 4) + steps.reduce((n, s) => n + Math.round(s.output.length / 4), 0);
    const output = Math.max(1, Math.round(text.length / 4)) + steps.length * 24;
    const end = live ? Date.now() : clock;
    emit({ type: "run.finished", status: "succeeded", exitCode: 0, text, tokens: { input, output, total: input + output, cacheRead: 0, cacheWrite: 0 }, durationMs: end - start, sessionId, error: null });
    const priced = model.data.pricing ? (input * model.data.pricing.inputPerMTok + output * model.data.pricing.outputPerMTok) / 1e6 : null;
    (state.sessions[profile] ??= []).push({
      id: sessionId, source: "cli", model: model.data.model, billingProvider: `custom:mcbot-${model.data.name}`, billingBaseUrl: model.data.baseUrl,
      startedAt: Math.floor(start / 1000), endedAt: Math.floor(end / 1000), inputTokens: input, outputTokens: output, cacheReadTokens: 0, cacheWriteTokens: 0,
      reasoningTokens: 0, apiCalls: 1 + steps.length, toolCalls: steps.length, messages: 2 + steps.length * 2, estimatedCostUsd: null, actualCostUsd: null, costStatus: "unknown", title: null,
    });
    emit({ type: "run.cost", sessionId, model: model.data.model, provider: `custom:mcbot-${model.data.name}`, reportedUsd: null, costStatus: "unknown", estimatedUsd: priced });
    busy.set(profile, Math.max(0, (busy.get(profile) ?? 1) - 1));
    save();
  };
  if (live) void run();
  else await run();
  return runId;
}

function remember(profile: string, content: string): void {
  const m = (state.memory[profile] ??= { memory: [], user: [] });
  if (m.memory.includes(content)) return;
  if ([...m.memory, content].join(DELIM).length <= LIMITS.memory) m.memory.push(content);
}

// ---------- memory ----------

function memoryView(profile: string, target: Target): MemoryFileView {
  const entries = state.memory[profile]?.[target] ?? [];
  const text = entries.length ? `${entries.join(DELIM)}` : "";
  return {
    target, path: `${ROOT}/profiles/${profile}/memories/${target === "memory" ? "MEMORY" : "USER"}.md`, exists: entries.length > 0, entries,
    chars: text.length, limit: LIMITS[target], sha256: entries.length ? sha256Hex(text) : null,
  };
}

// ---------- files: compiled profiles, the shared folder, a sample project ----------

function listVirtual(files: Record<string, string>, dir: string): FsEntry[] {
  const prefix = dir ? `${dir}/` : "";
  const seen = new Map<string, FsEntry>();
  for (const [path, body] of Object.entries(files)) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const [name, ...more] = rest.split("/");
    if (!name) continue;
    const child = `${prefix}${name}`;
    if (more.length || body === "\0dir") {
      const kids = new Set(Object.keys(files).filter((p) => p.startsWith(`${child}/`)).map((p) => p.slice(child.length + 1).split("/")[0]).filter((n) => n && n !== ".keep"));
      seen.set(name, { name, path: child, kind: "dir", bytes: 0, children: kids.size, owned: false });
    } else {
      seen.set(name, { name, path: child, kind: "file", bytes: utf8Bytes(body).length, children: null, owned: false });
    }
  }
  return [...seen.values()].sort((a, b) => Number(b.kind === "dir") - Number(a.kind === "dir") || a.name.localeCompare(b.name));
}

function profileFiles(profile: string): Record<string, string> {
  const dir = `profiles/${profile}/`;
  const out: Record<string, string> = {};
  for (const d of PROFILE_DIRS) out[`${d}/.keep`] = "";
  for (const [p, body] of Object.entries(state.disk)) if (p.startsWith(dir)) out[p.slice(dir.length)] = body;
  for (const t of ["memory", "user"] as const) {
    const entries = state.memory[profile]?.[t] ?? [];
    if (entries.length) out[`memories/${t === "memory" ? "MEMORY" : "USER"}.md`] = entries.join(DELIM);
  }
  for (const s of state.sessions[profile] ?? []) out[`sessions/session_${s.id}.json`] = `${JSON.stringify({ id: s.id, model: s.model, input_tokens: s.inputTokens, output_tokens: s.outputTokens }, null, 2)}\n`;
  return out;
}

function filesOf(rootId: string): { files: Record<string, string>; owned: (p: string) => boolean } {
  if (rootId === "workspace:files") return { files: sharedFiles, owned: () => false };
  if (rootId === SAMPLE_FOLDER.id && state.sampleOpen) return { files: sampleProject, owned: () => false };
  if (rootId.startsWith("profile:") && manifest()?.profiles.includes(rootId.slice(8))) {
    const profile = rootId.slice(8);
    const owned = new Set(manifest()?.files.map((f) => f.path) ?? []);
    return { files: profileFiles(profile), owned: (p) => owned.has(`profiles/${profile}/${p}`) };
  }
  throw new EngineError(404, "unknown folder", {});
}

// ---------- the API ----------

function bundlesOf(boardId: string) {
  return resolveGraph(graphOf(boardId));
}

function requireBoard(boardId: string): string {
  if (!state.boards.some((b) => b.id === boardId)) throw new EngineError(404, "no such board", {});
  return boardId;
}

async function seedHistory(): Promise<void> {
  const { bundles } = resolveGraph(seedGraph);
  const now = new Date();
  for (const [profile, prompt, daysAgo, hour] of seedRuns) {
    const bundle = bundles.find((b) => b.agent.data.name === profile)!;
    const at = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo, daysAgo === 0 ? Math.min(hour, now.getUTCHours()) : hour, 12);
    await play(SEED_BOARD.id, bundle, prompt, { at: Math.min(at, Date.now() - 60_000) });
  }
}

/** Loaded on first use, so importing this module (the desktop build does) costs nothing. */
let loading: Promise<void> | null = null;
const ready = () => (loading ??= load());
async function load(): Promise<void> {
  const saved = store.get(STATE_KEY);
  if (saved) {
    try {
      state = JSON.parse(saved) as State;
      return;
    } catch {
      /* start over */
    }
  }
  state = { boards: [SEED_BOARD], disk: {}, runs: {}, memory: structuredClone(seedMemory), sessions: {}, sampleOpen: true };
  for (const f of compile(seedGraph).files) state.disk[f.path] = f.content;
  await seedHistory();
  save();
}

/** The fork's real upstream record; the gateway itself is simulated (no Hermes runs in a browser). */
function demoHermes(): HermesInfo {
  const running = Object.values(state.runs).some((e) => !e.some((x) => x.type === "run.finished"));
  return {
    kind: "bundled", path: "simulated in this browser", upstream: { url: upstream.upstream, commit: upstream.commit, date: upstream.date },
    root: ROOT, managedRoot: true, gateway: { running, pid: null }, source: true, installed: true, setup: { state: "done", lines: [] },
  };
}

/** Forget everything this browser stored for the demo. */
export function resetDemo(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("mcbot.demo.")) localStorage.removeItem(k);
  } catch {
    /* nothing stored */
  }
  location.reload();
}

const api = <A extends unknown[], R>(f: (...a: A) => R | Promise<R>) => async (...a: A): Promise<Awaited<R>> => {
  await ready();
  return await f(...a);
};

export const demoEngine = {
  health: api((): Health => ({ ok: true, version: "0.1.0", workspace: WORKSPACE, hermesHome: ROOT, managedRoot: true, hermes: { found: true, path: "simulated in this browser", kind: "bundled" } })),
  hermes: api((): HermesInfo => demoHermes()),
  diagnostics: api((): Diagnostics => ({
    text: [
      "McBot 0.1.0 · browser demo",
      `System: ${navigator.userAgent}`,
      "Engine: simulated in this browser",
      `Boards: ${state.boards.length}`,
      `Time: ${new Date().toISOString()}`,
      "",
      "No engine log: the browser demo simulates its runs.",
      "",
    ].join("\n"),
  })),
  prepareHermes: api((): HermesInfo => demoHermes()),
  restartGateway: api(async (): Promise<HermesInfo> => {
    await sleep(600);
    return demoHermes();
  }),
  boards: api((): BoardInfo[] => state.boards),
  createBoard: api((name: string): BoardInfo => {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "board";
    const b = { id: `${slug}-${Math.random().toString(16).slice(2, 6)}`, name };
    state.boards.push(b);
    save();
    return b;
  }),
  compile: api((boardId: string) => compileBoard(requireBoard(boardId), false)),
  preview: api((boardId: string) => compileBoard(requireBoard(boardId), true)),
  runs: api((boardId: string): RunSummary[] =>
    Object.values(state.runs).map((e) => summarizeRun(e)).filter((s): s is RunSummary => !!s && s.boardId === boardId).sort((a, b) => b.startedAt - a.startedAt)),
  run: api((runId: string): RunEvent[] => {
    const events = state.runs[runId];
    if (!events) throw new EngineError(404, "no such run", {});
    return events;
  }),
  startRun: api(async (boardId: string, agentNodeId: string, prompt: string) => {
    const { bundles, issues } = bundlesOf(requireBoard(boardId));
    const bundle = bundles.find((b) => b.agent.id === agentNodeId);
    if (!bundle) throw new EngineError(404, "no such agent on this board", {});
    const drift = compileBoard(boardId, true);
    if (!drift.ok) throw new EngineError(409, "The board has errors; fix them before running.", { issues });
    const dir = `profiles/${bundle.agent.data.name}/`;
    const stale = drift.report.changes.filter((c) => c.path.startsWith(dir) && c.status !== "unchanged");
    if (stale.length) throw new EngineError(409, `The board changed since ${bundle.agent.data.name} was last compiled. Compile, then run.`, { stale: stale.map((c) => c.path) });
    return { runId: await play(boardId, bundle, prompt) };
  }),
  cancelRun: api((runId: string) => {
    const events = state.runs[runId];
    const done = events?.some((e) => e.type === "run.finished");
    if (events && !done) cancelled.add(runId);
    return { cancelled: !!events && !done };
  }),
  memory: api((boardId: string): AgentMemoryView[] => {
    const compiled = manifest()?.profiles ?? [];
    return bundlesOf(requireBoard(boardId)).bundles.map(({ agent }) => ({
      profile: agent.data.name, nodeId: agent.id, displayName: agent.data.displayName || agent.data.name, compiled: compiled.includes(agent.data.name),
      busy: (busy.get(agent.data.name) ?? 0) > 0, memory: memoryView(agent.data.name, "memory"), user: memoryView(agent.data.name, "user"),
    }));
  }),
  saveMemory: api((profile: string, target: Target, entries: string[], baseSha256: string | null): MemoryFileView => {
    if (!manifest()?.profiles.includes(profile)) throw new EngineError(404, `profile ${profile} is not compiled by McBot`, {});
    if ((busy.get(profile) ?? 0) > 0) throw new EngineError(409, `${profile} is running; edit its memory when the run finishes`, {});
    if (memoryView(profile, target).sha256 !== baseSha256) throw new EngineError(409, "Memory changed since you opened it; reopen to see the latest.", {});
    const clean = entries.map((e) => e.trim()).filter(Boolean);
    if (clean.join(DELIM).length > LIMITS[target]) throw new EngineError(400, `Over the ${LIMITS[target]}-character limit`, {});
    (state.memory[profile] ??= { memory: [], user: [] })[target] = clean;
    save();
    return memoryView(profile, target);
  }),
  cost: api((boardId: string): CostReport => {
    const { bundles } = bundlesOf(requireBoard(boardId));
    const compiled = manifest()?.profiles ?? [];
    const profiles = bundles.filter((b) => compiled.includes(b.agent.data.name)).map((b) => ({ profile: b.agent.data.name, agentNodeId: b.agent.id, sessions: state.sessions[b.agent.data.name] ?? [] }));
    const models = [...new Map(bundles.flatMap((b) => b.models).map((m) => [m.id, m])).values()];
    const runs = Object.values(state.runs).map((e) => summarizeRun(e)).filter((s): s is RunSummary => !!s && s.boardId === boardId);
    return buildCostReport(profiles, runs, models);
  }),
  roots: api((boardId: string): FsRoot[] => {
    const compiled = manifest()?.profiles ?? [];
    const profiles: FsRoot[] = bundlesOf(requireBoard(boardId)).bundles
      .filter((b) => compiled.includes(b.agent.data.name))
      .map((b) => ({ id: `profile:${b.agent.data.name}`, kind: "profile", name: b.agent.data.displayName || b.agent.data.name, path: `${ROOT}/profiles/${b.agent.data.name}`, nodeId: b.agent.id }));
    return [...profiles, { id: "workspace:files", kind: "workspace", name: "Shared files", path: `${WORKSPACE}/files` }, ...(state.sampleOpen ? [SAMPLE_FOLDER] : [])];
  }),
  openFolder: api((_path: string): FsRoot => {
    if (!state.sampleOpen) {
      state.sampleOpen = true;
      save();
      return SAMPLE_FOLDER;
    }
    throw new EngineError(400, "The browser demo can't read your disk. The desktop app opens any folder.", {});
  }),
  closeFolder: api((id: string) => {
    if (id === SAMPLE_FOLDER.id) state.sampleOpen = false;
    save();
    return { ok: true as const };
  }),
  list: api((root: string, path: string): FsListing => {
    const { files, owned } = filesOf(root);
    const entries = listVirtual(files, path).filter((e) => e.name !== ".keep").map((e) => ({ ...e, owned: e.kind === "file" && owned(e.path) }));
    return { root, path, entries, truncated: 0 };
  }),
  setup: api((): SetupState => state.setup ?? { completed: false, profile: null }),
  setupDetect: api(async (): Promise<SetupDetect> => {
    await sleep(700);
    // Simulated: a browser cannot see what runs on the visitor's computer.
    return { hermes: { found: true, path: "simulated in this browser", kind: "bundled" }, local: [{ name: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", models: ["gemma3:4b", "llama3.2:3b", "qwen3:8b"] }], secrets: [...secretNames] };
  }),
  setupModels: api((_baseUrl: string, _keyName?: string) => ({ models: null as string[] | null })),
  setupBoard: api((name: string, graph: Graph): BoardInfo => {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "board";
    const b = { id: `${slug}-${Math.random().toString(16).slice(2, 6)}`, name };
    state.boards.push(b);
    (state.pending ??= {})[b.id] = { ...graph, id: b.id, name };
    save();
    return b;
  }),
  setupComplete: api((profile: SetupProfile | null): SetupState => {
    state.setup = { completed: true, profile };
    save();
    return state.setup;
  }),
  secrets: api(() => ({ names: [...secretNames] })),
  // Runs are simulated here, so no agent ever makes a real image or video.
  media: async (_profile: string, _path: string): Promise<Blob> => {
    throw new EngineError(404, "Runs are simulated in this demo", {});
  },
  setSecret: api((name: string, value: string) => {
    if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(name) || !value.trim()) throw new EngineError(400, "That key doesn't look right", {});
    secretNames.add(name);
    return { names: [...secretNames] };
  }),
  read: api((root: string, path: string): FsPreview => {
    const { files } = filesOf(root);
    const text = files[path];
    if (text === undefined) throw new EngineError(404, "no such file", {});
    return { path, bytes: utf8Bytes(text).length, text };
  }),
};

export function subscribeDemoEvents(onEvent: Listener, onStatus?: (connected: boolean) => void): () => void {
  listeners.add(onEvent);
  onStatus?.(true);
  return () => listeners.delete(onEvent);
}
