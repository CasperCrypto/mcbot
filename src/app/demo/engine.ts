/**
 * The browser demo's engine: the same API as engine/server.ts, served inside
 * the page. Compile is the real compiler writing to an in-memory disk; runs are
 * simulated (no Hermes, no model), clearly labelled as such in the UI.
 * Built only in demo mode (`npm run build:demo`, `vite build --mode demo`).
 */
import { createTwoFilesPatch } from "diff";
import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import { buildCostReport } from "../../../engine/cost";
import type { SessionRow } from "../../../engine/hermesData";
import { exportFileName } from "../../board/files";
import { graphFromDoc, loadGraphIntoDoc } from "../../board/ydoc";
import { compile, mcpToolPrefix, PROFILE_DIRS, resolveGraph, type AgentBundle } from "../../compile/index";
import { addVersion, type HarnessVersion } from "../../harness/versions";
import { sha256Hex, utf8Bytes } from "../../compile/text";
import { LIBRARY } from "../../contracts/library.generated";
import type { HarnessPlan, PlanChoices } from "../../harness/plan";
import type { CatalogPlugin, InstalledPlugin, LibrarySkill, ProfileSkill, SkillSearchResult, SkillsView, AgentMemoryView, BoardExport, BoardInfo, CompileResponse, CostReport, Diagnostics, FsBrowse, FsEntry, FsListing, FsPreview, FsRoot, Health, HermesInfo, MemoryFileView, AgentSchedules, ScheduleView, SetupDetect, SetupProfile, SetupState, SharingView, GuestView, GitHubRepoView, LoginView, SignInView, TaskAction, UpdateView, TaskDetail, TasksView, TaskView, LearnExport, LearnView, DocUpload, TrainJob } from "../../contracts/api";
import upstream from "../../../hermes/UPSTREAM.json";
import { version as APP_VERSION } from "../../../package.json";
import { MANIFEST_PATH, type FileChange, type Manifest } from "../../contracts/compile";
import { DOC_TEXT_MAX, GRAPH_SCHEMA, type Graph } from "../../contracts/graph";
import { applyToDoc, agentEditable } from "../../harness/live";
import { mergeConfig } from "../../harness/merge";
import { readHermes, unshownNote, type ProfileFiles } from "../../harness/read";
import { followChanges } from "../../harness/reconcile";
import { RUN_EVENT_VERSION, summarizeRun, type RunEvent, type RunEventInput, type RunSummary } from "../../contracts/run";
import { EngineError } from "../lib/engineError";
import { ROOT, SEED_BOARD, WORKSPACE, sampleProject, seedGraph, seedMemory, seedRuns, sharedFiles } from "./seed";
import { MIN_TRAIN_EXAMPLES, agentStats, conversationsOf, datasetLines, rewardOf, toolsUsed, type ConversationInput, type DatasetFormat, type DatasetPick, type Rating } from "../../harness/learn";
import { renderSoul } from "../../compile/soul";

type Target = "memory" | "user";
/** The local model server the demo pretends to find (setup lists it, Home asks it). */
const demoSignIns = new Map<string, SignInView>();
const DEMO_OLLAMA = "http://127.0.0.1:11434/v1";
const DEMO_OLLAMA_MODELS = ["gemma3:4b", "llama3.2:3b", "qwen3:8b"];
const LIMITS: Record<Target, number> = { memory: 2200, user: 1375 };
const DELIM = "\n§\n";
const STATE_KEY = "mcbot.demo.v1";
const boardKey = (id: string) => `mcbot.demo.board.${id}`;
const SAMPLE_FOLDER: FsRoot = { id: "folder:sample", kind: "folder", name: "support-desk", path: "/Users/you/Projects/support-desk" };

interface State {
  boards: BoardInfo[];
  /** The compile output root: path relative to ROOT → content. */
  disk: Record<string, string>;
  runs: Record<string, RunEvent[]>;
  memory: Record<string, Record<Target, string[]>>;
  sessions: Record<string, SessionRow[]>;
  sampleOpen: boolean;
  /** Hermes' kanban, simulated: every task of the demo's Hermes home. */
  tasks?: TaskDetail[];
  /** Hermes' cron jobs per profile, simulated (they never fire in the browser). */
  schedules?: Record<string, ScheduleView[]>;
  /** Harness versions per board (src/harness/versions.ts), as the engine keeps them. */
  versions?: Record<string, HarnessVersion[]>;
  /** Thumbs up / down on answers (Learn), by run id. */
  ratings?: Record<string, Rating>;
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

/**
 * Two simulated teammates on the demo's own board, so the team features show without a second
 * computer: Sam and Lee are here (cursors on the board), and Sam answers your first message.
 * A second tab on the same board is real presence, as before.
 */
const TEAMMATES = [
  { id: 900_001, name: "Sam", color: "#30d158", tab: "graph", home: { x: 380, y: 120 } },
  { id: 900_002, name: "Lee", color: "#bf5af2", tab: "tasks", home: { x: 60, y: 420 } },
];
function simulateTeammates(doc: Y.Doc, awareness: Awareness): () => void {
  let step = 0;
  const beat = () => {
    step++;
    for (const t of TEAMMATES) {
      const wobble = { x: t.home.x + Math.round(Math.sin(step / 3 + t.id) * 60), y: t.home.y + Math.round(Math.cos(step / 4 + t.id) * 40) };
      awareness.states.set(t.id, { user: { name: t.name, color: t.color }, tab: t.tab, cursor: t.tab === "graph" ? wobble : null, selection: null });
      awareness.meta.set(t.id, { clock: step, lastUpdated: Date.now() });
    }
    awareness.emit("change", [{ added: step === 1 ? TEAMMATES.map((t) => t.id) : [], updated: step === 1 ? [] : TEAMMATES.map((t) => t.id), removed: [] }, "local"]);
  };
  beat();
  const timer = setInterval(beat, 1500);
  // Sam answers the first message you send.
  const messages = doc.getMap<{ author: string; agent: string; at: number }>("messages");
  // A demo board saved before team chat existed gets the opening conversation too.
  if (messages.size === 0) doc.transact(() => { for (const m of seedGraph.messages ?? []) messages.set(m.id, { ...m }); });
  let answered = false;
  const onMessage = (e: Y.YMapEvent<{ author: string; agent: string; at: number }>) => {
    if (answered) return;
    for (const key of e.keysChanged) {
      const m = messages.get(key);
      if (!m || m.agent || TEAMMATES.some((t) => t.name === m.author)) continue;
      answered = true;
      setTimeout(() => messages.set(`msg-sam-${Date.now()}`, { id: `msg-sam-${Date.now()}`, author: "Sam", color: "#30d158", agent: "", text: "On it. Ping @triage if a ticket needs routing.", at: Date.now() } as never), 1600);
    }
  };
  messages.observe(onMessage);
  return () => {
    clearInterval(timer);
    messages.unobserve(onMessage);
    removeAwarenessStates(awareness, TEAMMATES.map((t) => t.id), "local");
  };
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
  const stopTeam = boardId === SEED_BOARD.id ? simulateTeammates(doc, awareness) : () => undefined;
  return {
    awareness,
    synced: true,
    on: () => undefined,
    off: () => undefined,
    destroy() {
      stopTeam();
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
  const compiled = compile(graph);
  // As the engine's writer: config.yaml is merged, so settings made outside the board stay.
  const result = { ...compiled, files: compiled.files.map((f) => {
    if (f.role !== "config") return f;
    const content = mergeConfig(state.disk[f.path] ?? null, f.content);
    return content === f.content ? f : { ...f, content, sha256: sha256Hex(content), bytes: utf8Bytes(content).length };
  }) };
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
    // As the engine: a new harness version when this compile changed it.
    state.versions = { ...(state.versions ?? {}), [boardId]: addVersion(state.versions?.[boardId] ?? [], graph, Date.now()) };
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
/** Runs waiting on an approval card, by run id. */
const answers = new Map<string, (choice: string) => void>();
/** Training jobs started in the demo (simulated). */
const demoTrain: TrainJob[] = [];
/** A question the simulated agent asked, waiting for the page's answer (run id → its resolver). */
const replies = new Map<string, (answer: string) => void>();
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
  if (/\b(plan|week|calendar|campaign|posts)\b/i.test(prompt)) {
    // A multi-step job: the agent writes its plan first (Hermes' todo_list), then works through it.
    const todo = (statuses: string[]) => ({ todos: ["Pick this week's themes from the goals", "Draft a post for each day", "Make an image for each post", "Put them in a calendar for your OK"].map((content, i) => ({ id: String(i + 1), content, status: statuses[i] })) });
    const all = (s: string) => Array(4).fill(s) as string[];
    return {
      steps: [
        { tool: "todo_list", input: todo(["in_progress", "pending", "pending", "pending"]), output: JSON.stringify(todo(["in_progress", "pending", "pending", "pending"])), toolNodeId: null },
        { tool: "todo_list", input: { ...todo(["completed", "completed", "in_progress", "pending"]), merge: true }, output: JSON.stringify(todo(["completed", "completed", "in_progress", "pending"])), toolNodeId: null },
        { tool: "todo_list", input: { ...todo(all("completed")), merge: true }, output: JSON.stringify(todo(all("completed"))), toolNodeId: null },
      ],
      text: "Here's the week:\n\n| Day | Post | Image |\n|---|---|---|\n| Mon | Fresh sourdough, still warm | Loaf on the counter, morning light |\n| Wed | Behind the scenes at 5 am | Hands shaping dough |\n| Fri | Weekend cake orders open | Cake with candles |\n\nSay OK and I'll schedule them.",
    };
  }
  if (/\b(draw|diagram|sketch|map out)\b/i.test(prompt)) {
    // A drawing, as an agent would answer with one (chat/drawing.ts, skeleton form).
    const box = (id: string, x: number, y: number, text: string) => ({ type: "rectangle", id, x, y, width: 170, height: 64, roundness: { type: 3 }, label: { text } });
    const arrow = (x: number, from: string, to: string) => ({ type: "arrow", x, y: 32, width: 70, height: 0, start: { id: from }, end: { id: to } });
    const scene = [box("ask", 0, 0, "You ask"), arrow(170, "ask", "plan"), box("plan", 240, 0, "Agent plans"), arrow(410, "plan", "tools"), box("tools", 480, 0, "Uses tools"), arrow(650, "tools", "answer"), box("answer", 720, 0, "Answers you")];
    return { steps: [], text: `Here's how a message flows through this harness:\n\n\`\`\`excalidraw\n${JSON.stringify(scene)}\n\`\`\`\n\nOpen it to move things around.` };
  }

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
    let { steps, text } = script(prompt, bundle);
    if (await wait(650)) return finish("interrupted", "");
    // A risky command asks first, as Hermes does: the approval card, answered in the page.
    const risky = live ? /\b(rm -rf|delete|drop table|sudo|wipe)\b/i.exec(prompt) : null;
    if (risky) {
      const command = prompt.match(/`([^`]+)`/)?.[1] ?? prompt.slice(0, 120);
      const promptId = `p${runId.slice(-8)}`;
      emit({ type: "run.approval", promptId, generation: 1, command, description: `asks before: ${risky[1]}`, choices: ["once", "session", "always", "deny"] });
      const choice = await new Promise<string>((resolve) => answers.set(runId, resolve));
      emit({ type: "run.approval.settled", promptId, choice });
      if (choice === "deny") {
        steps = [];
        text = "You said no, so I left it alone. Tell me another way to do it if you like.";
      } else {
        steps = [{ tool: "terminal", input: { command }, output: JSON.stringify({ output: "", exit_code: 0 }), toolNodeId: null }];
        text = `Done: ${command} (simulated in this browser).`;
      }
    }
    // "Ask me…" / "which one" / "choose": the agent stops to ask, as Hermes' clarify does (the question card).
    if (live && /\b(ask me|which one|choose)\b/i.test(prompt)) {
      const promptId = `q${runId.slice(-8)}`;
      const question = "Which version should I go with?";
      emit({ type: "run.tool.started", tool: "clarify", input: { preview: question }, toolNodeId: null });
      emit({ type: "run.question", promptId, generation: 1, question, choices: ["The short one (Recommended)", "The detailed one"], multiSelect: false, timeoutS: 90 });
      const answer = await new Promise<string>((resolve) => { replies.set(runId, resolve); setTimeout(() => resolve(""), 90_000); });
      replies.delete(runId);
      emit({ type: "run.question.settled", promptId, answer: answer || null });
      emit({ type: "run.tool.finished", tool: "clarify", output: JSON.stringify({ responses: [{ question, user_response: answer || null }] }), durationMs: 1, isError: false, toolNodeId: null });
      const picked = answer.replace(/\s*\(Recommended\)$/i, "").trim();
      text = answer ? `Going with ${picked.toLowerCase()}. ${text}` : `No answer, so I went with the short one. ${text}`;
    }
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

/** Passwords in the demo: kept in the page only, a sample to show the view. */
let demoLogins: (LoginView & { password: string })[] = [
  { id: "l-1", url: "https://github.com", host: "github.com", username: "you@example.com", note: "", updatedAt: Date.now() - 86_400_000, password: "demo-only-password" },
];

/** The demo can't share: Share says so, and its sheet shows who joined the demo's own board. */
const demoShare = (members: SharingView["members"]): SharingView => ({
  on: false, addresses: [], port: 4318, reach: "network", publicUrl: null, ownUrl: null, tunnel: { state: "off", error: null }, web: false, members, invite: null, link: null, invites: [],
});

function requireBoard(boardId: string): string {
  if (!state.boards.some((b) => b.id === boardId)) throw new EngineError(404, "no such board", {});
  return boardId;
}

async function seedHistory(): Promise<void> {
  const { bundles } = resolveGraph(seedGraph);
  const now = new Date();
  const ratings: Record<string, Rating> = {};
  for (const [profile, prompt, daysAgo, hour, score] of seedRuns) {
    const bundle = bundles.find((b) => b.agent.data.name === profile)!;
    const at = Math.min(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo, daysAgo === 0 ? Math.min(hour, now.getUTCHours()) : hour, 12), Date.now() - 60_000);
    const runId = await play(SEED_BOARD.id, bundle, prompt, { at });
    if (score !== undefined) ratings[runId] = { score, by: "Maya", at: at + 60_000 };
  }
  state.ratings = ratings;
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
  seedVersions();
  save();
}

/**
 * Two versions of the sample harness, so History has something to compare: a week ago the
 * researcher thought with the local model; three days ago it moved to the cloud one (today's board).
 * The seeded runs fall on both sides.
 */
function seedVersions(): void {
  const now = new Date();
  const day = (ago: number) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ago);
  const local: Graph = { ...seedGraph, edges: seedGraph.edges.map((e) => (e.id === "e-cloud-research" ? { ...e, source: "model-local" } : e)) };
  const first = addVersion([], local, day(7));
  first[0]!.name = "All local";
  const both = addVersion(first, seedGraph, day(3));
  both[1]!.name = "Researcher on Claude";
  state.versions = { [SEED_BOARD.id]: both };
}

// ---------- tasks: Hermes' kanban, simulated (the desktop app runs them through Hermes) ----------

const taskId = () => `t_${Math.random().toString(16).slice(2, 10).padEnd(8, "0")}`;

function teamOf(boardId: string): Map<string, string> {
  const compiled = manifest()?.profiles ?? [];
  return new Map(bundlesOf(boardId).bundles.filter((b) => compiled.includes(b.agent.data.name)).map((b) => [b.agent.data.name, b.agent.id]));
}

function taskView(t: TaskDetail, team: Map<string, string>): TaskDetail {
  return { ...t, agentNodeId: t.assignee ? team.get(t.assignee) ?? null : null, comments: t.thread.length };
}

function findTask(id: string): TaskDetail {
  const t = (state.tasks ?? []).find((x) => x.id === id);
  if (!t) throw new EngineError(404, "no such task", {});
  return t;
}

/** The dispatcher, simulated: a ready task with an agent starts, then that agent finishes it. */
async function dispatch(t: TaskDetail, boardId: string): Promise<void> {
  if (!t.assignee || t.status !== "ready") return;
  const bundle = bundlesOf(boardId).bundles.find((b) => b.agent.data.name === t.assignee);
  if (!bundle) return;
  await sleep(1200);
  if (t.status !== "ready") return;
  const attempt = { id: t.attempts.length + 1, profile: t.assignee, status: "running", outcome: null, summary: null, error: null, startedAt: Date.now(), endedAt: null };
  t.attempts.push(attempt);
  // Its work so far, as the task panel shows a real one (engine/hermesData.ts readTaskWork).
  const step = (tool: string, detail: string) => ({ tool, detail, at: Date.now() });
  Object.assign(t, { status: "running", startedAt: Date.now(), work: { steps: 1, recent: [step("read_file", "tickets/today.md")], said: null, lastAt: Date.now() } });
  save();
  await sleep(1300);
  if ((t.status as string) !== "running") return;
  t.work = { steps: 2, recent: [...(t.work?.recent ?? []), step("search_files", t.title.slice(0, 60))], said: "Reading the tickets and sorting them by team.", lastAt: Date.now() };
  save();
  await sleep(1300);
  // A person may have blocked or finished it meanwhile.
  if ((t.status as string) !== "running") return;
  const summary = script(`${t.title}\n${t.body}`.trim(), bundle).text;
  Object.assign(attempt, { status: "done", outcome: "completed", summary, endedAt: Date.now() });
  Object.assign(t, { status: "done", completedAt: Date.now(), result: summary, work: { ...t.work!, said: summary.split("\n")[0]!.slice(0, 300), lastAt: Date.now() } });
  save();
}

function seedTasks(): TaskDetail[] {
  const now = Date.now();
  const base = { priority: 0, error: null, parents: [], children: [], comments: 0, thread: [], attempts: [], agentNodeId: null };
  return [
    { ...base, id: "t_5eed0001", title: "Route this morning's tickets", body: "Everything in tickets/ from today.", assignee: "triage", status: "done", createdBy: "Ada",
      createdAt: now - 3 * 3600_000, startedAt: now - 3 * 3600_000 + 60_000, completedAt: now - 3 * 3600_000 + 140_000, result: "Billing → Sam (2). Outage → paging the on-call (1).",
      attempts: [{ id: 1, profile: "triage", status: "done", outcome: "completed", summary: "Billing → Sam (2). Outage → paging the on-call (1).", error: null, startedAt: now - 3 * 3600_000 + 60_000, endedAt: now - 3 * 3600_000 + 140_000 }] },
    { ...base, id: "t_5eed0002", title: "Answer: can we export invoices as CSV?", body: "Customer asked in ticket 1042.", assignee: "researcher", status: "review", createdBy: "triage",
      createdAt: now - 40 * 60_000, startedAt: now - 38 * 60_000, completedAt: null, result: "Yes: Settings → Billing → Export, CSV or PDF (docs/billing.md).",
      thread: [{ id: 1, author: "researcher", body: "Drafted from docs/billing.md. Please check before it goes out.", at: now - 30 * 60_000 }] },
    { ...base, id: "t_5eed0003", title: "Find the outage post-mortem template", body: "", assignee: null, status: "todo", createdBy: "Ada", createdAt: now - 10 * 60_000, startedAt: null, completedAt: null, result: null },
  ];
}

function nextNine(weekdays: boolean, from = new Date()): number {
  const d = new Date(from);
  d.setHours(9, 0, 0, 0);
  while (d.getTime() <= from.getTime() || (weekdays && (d.getDay() === 0 || d.getDay() === 6))) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function demoSchedules(): Record<string, ScheduleView[]> {
  return (state.schedules ??= {
    triage: [{ id: "5eed00000001", name: "Morning sweep", prompt: "Route every ticket that came in overnight.", when: "0 9 * * 1-5", enabled: true, state: "scheduled", nextRunAt: nextNine(true), lastRunAt: null, lastStatus: null, lastError: null }],
  });
}

function schedulesOf(boardId: string, profile: string): AgentSchedules {
  const agentNodeId = teamOf(boardId).get(profile);
  if (!agentNodeId) throw new EngineError(409, `${profile} isn't a compiled agent on this board. Compile, then schedule it.`, {});
  return { agentNodeId, profile, schedules: demoSchedules()[profile] ?? [] };
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

/** Hermes' whole official library (generated from hermes/optional-skills); installs are simulated here. */
const DEMO_LIBRARY: readonly LibrarySkill[] = LIBRARY;
const demoInstalled: Record<string, Set<string>> = {};
/** A few real entries of Hermes' plugin catalog (hermes/plugin-catalog); installs are simulated here. */
const DEMO_PLUGINS: CatalogPlugin[] = [{"name": "abeyance", "title": "Abeyance", "summary": "Your Hermes cron jobs wait for you instead of guessing.", "description": "", "category": "automation", "tier": "community", "maintainer": "0xkinno", "repo": "https://github.com/0xkinno/abeyance", "version": "0.1.4", "platforms": ["linux"], "tools": 0, "hooks": 5, "needsKeys": []}, {"name": "advanced-delegation", "title": "Advanced Delegation", "summary": "Two extra delegation modes for `delegate_task`, next to the built-in default.", "description": "", "category": "tools", "tier": "official", "maintainer": "NousResearch", "repo": "https://github.com/NousResearch/hermes-official-plugins", "version": "1.1.1", "platforms": [], "tools": 0, "hooks": 0, "needsKeys": []}, {"name": "apify", "title": "Apify", "summary": "Apify, the largest marketplace of tools for AI: discover, run, and collect results from thousands of ready-to-run Actors, from the comfort of your agent, plus an Apify backend for the built-in web_search and web_extra…", "description": "", "category": "web", "tier": "verified", "maintainer": "apify", "repo": "https://github.com/apify/apify-hermes-agent-plugin", "version": "0.1.5", "platforms": [], "tools": 3, "hooks": 0, "needsKeys": ["APIFY_API_TOKEN"]}, {"name": "blender", "title": "Blender", "summary": "Official Blender Lab MCP server over stdio, pinned to upstream v1.0.3, with a Blender workflow skill.", "description": "", "category": "tools", "tier": "official", "maintainer": "NousResearch", "repo": "https://github.com/NousResearch/hermes-official-plugins", "version": "0.4.1", "platforms": ["windows", "macos", "linux"], "tools": 0, "hooks": 0, "needsKeys": []}, {"name": "camofox", "title": "camofox", "summary": "Camofox browser backend: browse with a self-hosted anti-detection Firefox (Camoufox, C++ fingerprint spoofing) through the camofox-browser REST server.", "description": "", "category": "web", "tier": "official", "maintainer": "NousResearch", "repo": "https://github.com/NousResearch/hermes-official-plugins", "version": "1.1.0", "platforms": [], "tools": 11, "hooks": 2, "needsKeys": ["CAMOFOX_URL"]}, {"name": "cua-spaces", "title": "Cua Spaces", "summary": "Cua's own plugin: runs Hermes's terminal, file and code tools inside a Cua Space, an isolated Linux, macOS or Windows machine you can watch live, as a terminal backend (`hermes config set terminal.backend cua`).", "description": "", "category": "tools", "tier": "verified", "maintainer": "trycua", "repo": "https://github.com/trycua/hermes-cua-spaces", "version": "0.4.0", "platforms": [], "tools": 0, "hooks": 0, "needsKeys": []}, {"name": "elevenlabs-music", "title": "ElevenLabs Music", "summary": "ElevenLabs Music for Hermes: describe a song or paste your lyrics and Hermes writes, generates and sends the track, 3 seconds to 10 minutes, vocals or instrumental.", "description": "", "category": "tools", "tier": "official", "maintainer": "NousResearch", "repo": "https://github.com/NousResearch/hermes-official-plugins", "version": "1.0.0", "platforms": [], "tools": 8, "hooks": 0, "needsKeys": ["ELEVENLABS_API_KEY"]}, {"name": "advisor", "title": "Advisor", "summary": "A persistent second model reviews every agent turn.", "description": "", "category": "automation", "tier": "community", "maintainer": "ljubomirj", "repo": "https://github.com/ljubomirj/hermes-advisor-plugin", "version": "1.2.0", "platforms": ["linux", "macos", "windows"], "tools": 0, "hooks": 2, "needsKeys": []}];
const demoPlugins: Record<string, InstalledPlugin[]> = {};
/** Skills the demo "finds" in the registries Hermes searches. */
const DEMO_FOUND: SkillSearchResult[] = [
  { name: "pdf", identifier: "skills-sh/anthropics/skills/pdf", source: "skills-sh", trust: "trusted", description: "Read, fill and merge PDF files." },
  { name: "xlsx", identifier: "skills-sh/anthropics/skills/xlsx", source: "skills-sh", trust: "trusted", description: "Make and edit spreadsheets with formulas and charts." },
  { name: "brand-voice", identifier: "clawhub/brand-voice", source: "clawhub", trust: "community", description: "Write in a company's tone, from a few samples." },
];
/** In the demo every agent has taught itself one skill during an earlier (simulated) run. */
const demoProfileSkills = (profile: string): ProfileSkill[] => [
  { name: "read-link-lists", path: "skills/read-link-lists/SKILL.md", category: null, description: "Open each link in a pasted list and summarise it in one line.", origin: "learned", modified: new Date(Date.now() - 2 * 86_400_000).toISOString() },
  ...[...(demoInstalled[profile] ?? [])].map((name): ProfileSkill => {
    const lib = DEMO_LIBRARY.find((l) => l.name === name);
    const found = DEMO_FOUND.find((f) => f.name === name);
    return { name, path: `skills/${lib?.category ?? "added"}/${name}/SKILL.md`, category: lib?.category ?? "added", description: lib?.description ?? found?.description ?? "", origin: "library", modified: new Date().toISOString() };
  }),
];

const boardRuns = (boardId: string): RunSummary[] =>
  Object.values(state.runs).map((e) => summarizeRun(e)).filter((s): s is RunSummary => !!s && s.boardId === boardId);
/** As engine/learn.ts `agentConversations`, from the demo's own runs. */
function demoConversations(b: AgentBundle, runs: readonly RunSummary[], rated: Readonly<Record<string, Rating>>): ConversationInput[] {
  const mine = runs.filter((r) => r.agentNodeId === b.agent.id);
  const events: Record<string, RunEvent[]> = {};
  const rewards: Record<string, number | null> = {};
  for (const r of mine) {
    events[r.runId] = state.runs[r.runId] ?? [];
    rewards[r.runId] = rewardOf(r, rated[r.runId], b.agent.data.checks ?? [], toolsUsed(events[r.runId]!));
  }
  return conversationsOf(mine).map((c) => ({ runs: c, events, rewards }));
}
function learnAgentView(b: AgentBundle, convs: readonly ConversationInput[], rated: Readonly<Record<string, Rating>>): LearnView["agents"][number] {
  const a = b.agent.data;
  return { agentNodeId: b.agent.id, profile: a.name, name: a.displayName || a.name, checks: a.checks?.length ?? 0, ...agentStats(convs, rated) };
}

export const demoEngine = {
  health: api((): Health => ({ ok: true, version: APP_VERSION, workspace: WORKSPACE, hermesHome: ROOT, managedRoot: true, hermes: { found: true, path: "simulated in this browser", kind: "bundled" } })),
  hermes: api((): HermesInfo => demoHermes()),
  diagnostics: api((): Diagnostics => ({
    text: [
      "McBot Studio · browser demo",
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
  versions: api((boardId: string) => ({ versions: state.versions?.[requireBoard(boardId)] ?? [] })),
  nameVersion: api((boardId: string, id: string, name: string) => {
    const list = state.versions?.[requireBoard(boardId)] ?? [];
    const v = list.find((x) => x.id === id);
    if (!v) throw new EngineError(404, "no such version", {});
    v.name = name.trim().slice(0, 80) || null;
    save();
    return { versions: list };
  }),
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
    const limit = bundle.agent.data.dailyBudgetUsd ?? 0;
    if (limit > 0) {
      const name = bundle.agent.data.name;
      const [b] = buildCostReport([{ profile: name, agentNodeId: bundle.agent.id, sessions: state.sessions[name] ?? [], dailyBudgetUsd: limit }], [], bundle.models).budgets;
      if (b?.state === "over") throw new EngineError(409, `${bundle.agent.data.displayName || name} reached today's budget ($${b.spentTodayUsd.toFixed(2)} of $${limit.toFixed(2)}). Raise it to keep going.`, { budget: b });
    }
    return { runId: await play(boardId, bundle, prompt) };
  }),
  answerRun: api((runId: string, choice: string) => {
    const resolve = answers.get(runId);
    if (!resolve) throw new EngineError(409, "This run is not waiting for an answer", {});
    answers.delete(runId);
    resolve(choice);
    return { answered: choice };
  }),
  // Training in the cloud, simulated: a job that validates, runs and succeeds in about half a minute. It is
  // refused as the engine refuses it: fewer than MIN_TRAIN_EXAMPLES conversations, or a provider without
  // OpenAI's fine-tuning API (the engine learns that from a 404; the demo, which asks nobody, from the host).
  trainJobs: async (boardId: string): Promise<TrainJob[]> => demoTrain.filter((j) => j.boardId === boardId).map((j) => {
    const age = Date.now() - j.createdAt;
    const status: TrainJob["status"] = j.status === "cancelled" ? "cancelled" : age < 5000 ? "validating" : age < 12_000 ? "queued" : age < 30_000 ? "running" : "succeeded";
    return { ...j, status, model: status === "succeeded" ? `ft:${j.baseModel}:demo::${j.profile}` : null, updatedAt: Date.now() };
  }),
  startTraining: async (boardId: string, agentNodeId: string, modelNodeId: string, baseModel: string, pick: DatasetPick = "good"): Promise<TrainJob> => {
    const graph = graphOf(requireBoard(boardId));
    const agent = graph.nodes.find((n) => n.id === agentNodeId && n.kind === "agent");
    const model = graph.nodes.find((n) => n.id === modelNodeId && n.kind === "model");
    if (!agent || !model || model.kind !== "model" || model.data.endpoint !== "cloud") throw new EngineError(409, "Pick one of the board's cloud models to train with", {});
    const bundle = resolveGraph(graph).bundles.find((b) => b.agent.id === agentNodeId);
    if (!bundle) throw new EngineError(404, "No such agent on this board", {});
    const { lines } = datasetLines(demoConversations(bundle, boardRuns(boardId), state.ratings ?? {}), { format: "chat", pick, system: "", model: null, at: "" });
    const name = bundle.agent.data.displayName || bundle.agent.data.name;
    if (lines.length < MIN_TRAIN_EXAMPLES) throw new EngineError(409, `Fine-tuning needs at least ${MIN_TRAIN_EXAMPLES} ${pick === "good" ? "good " : ""}conversations; ${name} has ${lines.length}. Rate answers in Chat or add checks`, {});
    const provider = model.data.label || new URL(model.data.baseUrl).hostname;
    if (new URL(model.data.baseUrl).hostname !== "api.openai.com") throw new EngineError(409, `${provider} doesn't take fine-tuning jobs through the OpenAI API. Use one that does (OpenAI), or train on this computer`, {});
    const now = Date.now();
    const job: TrainJob = {
      id: `train_demo_${now.toString(36)}`, boardId, agentNodeId, profile: bundle.agent.data.name, provider, baseUrl: model.data.baseUrl, keyEnv: model.data.apiKeyEnv,
      baseModel, model: null, remoteId: `ftjob-demo-${now}`, status: "validating", error: null, examples: lines.length, dataset: `${bundle.agent.data.name}-chat.jsonl`, createdAt: now, updatedAt: now,
    };
    demoTrain.unshift(job);
    return job;
  },
  cancelTraining: async (id: string): Promise<TrainJob> => {
    const job = demoTrain.find((j) => j.id === id);
    if (!job) throw new EngineError(404, "No such training job", {});
    job.status = "cancelled";
    return job;
  },
  // The browser demo reads text files itself; PDF and Office files need McBot's own Hermes (the desktop app).
  addDoc: async (name: string, data: Blob): Promise<DocUpload> => {
    if (!/\.(md|markdown|txt|text|csv|tsv|json|ya?ml|html?|xml|log)$/i.test(name)) throw new EngineError(409, "In this browser demo McBot reads text files; the desktop app reads PDF and Office files too", {});
    const raw = (await data.text()).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    return { name, text: raw.slice(0, DOC_TEXT_MAX), bytes: data.size, truncated: raw.length > DOC_TEXT_MAX, file: `knowledge/${name}` };
  },
  exportKnowledge: async (_boardId: string, markdown: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
    a.download = "knowledge.md";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return { path: "knowledge.md (downloaded)" };
  },
  replyRun: api((runId: string, promptId: string, answer: string) => {
    const resolve = replies.get(runId);
    if (!resolve) throw new EngineError(409, "This question was already answered or has expired", {});
    replies.delete(runId);
    resolve(answer);
    return { answered: promptId };
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
    const profiles = bundles.filter((b) => compiled.includes(b.agent.data.name)).map((b) => ({ profile: b.agent.data.name, agentNodeId: b.agent.id, sessions: state.sessions[b.agent.data.name] ?? [], dailyBudgetUsd: b.agent.data.dailyBudgetUsd ?? null }));
    const models = [...new Map(bundles.flatMap((b) => b.models).map((m) => [m.id, m])).values()];
    const runs = Object.values(state.runs).map((e) => summarizeRun(e)).filter((s): s is RunSummary => !!s && s.boardId === boardId);
    return buildCostReport(profiles, runs, models);
  }),
  ratings: api((boardId: string): Record<string, Rating> => {
    const mine = new Set(boardRuns(boardId).map((r) => r.runId));
    return Object.fromEntries(Object.entries(state.ratings ?? {}).filter(([id]) => mine.has(id)));
  }),
  rate: api((runId: string, score: 0 | 1 | null, note?: string) => {
    if (!state.runs[runId]) throw new EngineError(404, "No such run", {});
    const all = { ...(state.ratings ?? {}) };
    const rating: Rating | null = score === null ? null : { score, at: Date.now(), ...(note ? { note } : {}) };
    if (rating) all[runId] = rating;
    else delete all[runId];
    state.ratings = all;
    save();
    return { runId, rating };
  }),
  learn: api((boardId: string): LearnView => {
    const { bundles } = bundlesOf(requireBoard(boardId));
    const runs = boardRuns(boardId);
    const rated = state.ratings ?? {};
    return { agents: bundles.map((b) => learnAgentView(b, demoConversations(b, runs, rated), rated)), folder: "~/McBot/datasets" };
  }),
  exportDataset: api((boardId: string, agentNodeId: string, format: DatasetFormat, pick: DatasetPick): LearnExport => {
    const graph = graphOf(requireBoard(boardId));
    const { bundles } = resolveGraph(graph);
    const bundle = bundles.find((b) => b.agent.id === agentNodeId);
    if (!bundle) throw new EngineError(404, "No such agent on this board", {});
    const convs = demoConversations(bundle, boardRuns(boardId), state.ratings ?? {});
    const { lines } = datasetLines(convs, { format, pick, system: renderSoul(bundle.agent.data, bundle.team.map((t) => t.data), graph.brief), model: bundle.models[0]?.data.model ?? null, at: new Date().toISOString() });
    const file = `${bundle.agent.data.name}-${format}.jsonl`;
    return { file, path: "", shown: file, examples: lines.length, text: lines.join("\n") };
  }),
  share: api((): SharingView => demoShare([{ id: "m-sam", name: "Sam", joinedAt: Date.now() - 6 * 86_400_000, lastSeen: Date.now() - 60_000, role: "edit" }, { id: "m-lee", name: "Lee", joinedAt: Date.now() - 2 * 86_400_000, lastSeen: Date.now() - 3_600_000, role: "edit" }])),
  setShare: api((_on: boolean, _reach?: "network" | "internet"): SharingView => { throw new EngineError(409, "Sharing with other computers works in the desktop app. Here, open a second tab: it is live too.", {}); }),
  setShareReach: api((_reach: "network" | "internet", _ownUrl?: string | null): SharingView => demoShare([])),
  newInvite: api((_scope?: { role: "edit" | "chat"; boardId?: string; agents?: string[] }): SharingView => demoShare([])),
  removeMember: api((_id: string): SharingView => demoShare([])),
  guest: api((): GuestView => ({ host: "You", role: "edit", name: "You", boardId: null, agents: [] })),
  githubInspect: api((_url: string): GitHubRepoView => { throw new EngineError(409, "Adding from GitHub works in the desktop app.", {}); }),
  githubPlugin: api((_profile: string, _source: string): { installed: string } => { throw new EngineError(409, "Adding from GitHub works in the desktop app.", {}); }),
  githubDownload: api((_url: string): { folder: string; path: string } => { throw new EngineError(409, "Adding from GitHub works in the desktop app.", {}); }),
  logins: api((host?: string) => ({ logins: demoLogins.filter((l) => !host || l.host === host || host.endsWith(`.${l.host}`)).map(({ password: _p, ...v }) => v) })),
  saveLogin: api((l: { id?: string; url: string; username: string; password?: string; note?: string }) => {
    let url: URL;
    try { url = new URL(/^https?:\/\//.test(l.url) ? l.url : `https://${l.url}`); } catch { throw new EngineError(400, "Use the site's address, like mail.google.com", {}); }
    const old = demoLogins.find((x) => x.id === l.id);
    const next = { id: old?.id ?? `l-${demoLogins.length + 1}-${Date.now().toString(36)}`, url: url.origin, host: url.hostname, username: l.username, note: l.note ?? old?.note ?? "", updatedAt: Date.now(), password: l.password || old?.password || "" };
    demoLogins = [...demoLogins.filter((x) => x.id !== next.id), next];
    const { password: _p, ...login } = next;
    return { login, logins: demoLogins.map(({ password: _q, ...v }) => v) };
  }),
  removeLogin: api((id: string) => { demoLogins = demoLogins.filter((x) => x.id !== id); return { logins: demoLogins.map(({ password: _p, ...v }) => v) }; }),
  revealLogin: api((id: string) => { const l = demoLogins.find((x) => x.id === id); if (!l) throw new EngineError(404, "No such login", {}); return { username: l.username, password: l.password, host: l.host }; }),
  tasks: api((boardId: string): TasksView => {
    const team = teamOf(requireBoard(boardId));
    state.tasks ??= boardId === SEED_BOARD.id ? seedTasks() : [];
    // As the engine (engine/kanban.ts readTasks): a task made on a board stays on that board.
    const tasks = state.tasks.filter((t) => t.status !== "archived" && ((t as { board?: string }).board
      ? (t as { board?: string }).board === boardId
      : boardId === SEED_BOARD.id && (t.assignee === null || team.has(t.assignee) || (t.createdBy !== null && team.has(t.createdBy)))));
    return { tasks: tasks.map((t) => taskView(t, team)).sort((a, b) => b.createdAt - a.createdAt), gateway: true };
  }),
  task: api((boardId: string, id: string): TaskDetail => taskView(findTask(id), teamOf(requireBoard(boardId)))),
  createTask: api((boardId: string, input: { title: string; body: string; assignee: string | null; by: string; parents?: string[]; goal?: boolean }): TaskView => {
    const team = teamOf(requireBoard(boardId));
    if (input.assignee !== null && !team.has(input.assignee)) throw new EngineError(409, `${input.assignee} isn't a compiled agent on this board. Compile, then give it tasks.`, {});
    const t: TaskDetail & { board: string } = {
      board: boardId,
      id: taskId(), title: input.title.trim(), body: input.body, assignee: input.assignee, agentNodeId: null, status: input.assignee ? "ready" : "todo", priority: 0,
      createdBy: input.by, createdAt: Date.now(), startedAt: null, completedAt: null, result: null, error: null, parents: input.parents ?? [], children: [], comments: 0, thread: [], attempts: [],
      ...(input.goal ? { goal: true } : {}),
    };
    (state.tasks ??= []).push(t);
    save();
    void dispatch(t, boardId);
    return taskView(t, team);
  }),
  actOnTask: api((boardId: string, id: string, by: string, a: TaskAction): TaskDetail => {
    const team = teamOf(requireBoard(boardId));
    const t = findTask(id);
    const refuse = (why: string) => { throw new EngineError(409, why, {}); };
    switch (a.action) {
      case "comment": t.thread.push({ id: t.thread.length + 1, author: by, body: a.text, at: Date.now() }); break;
      case "assign":
        if (a.profile !== null && !team.has(a.profile)) refuse(`${a.profile} isn't a compiled agent on this board`);
        t.assignee = a.profile;
        if (t.status === "todo" && a.profile) t.status = "ready";
        break;
      case "complete": Object.assign(t, { status: "done", completedAt: Date.now(), result: a.text || t.result || (t.status === "review" ? null : `Marked done by ${by}`) }); break;
      case "block":
        if (!["ready", "todo", "running", "triage"].includes(t.status)) refuse(`cannot block ${id}: it is ${t.status}`);
        t.status = "blocked";
        if (a.text) t.thread.push({ id: t.thread.length + 1, author: by, body: a.text, at: Date.now() });
        break;
      case "unblock":
        if (t.status !== "blocked") refuse(`cannot unblock ${id}: not blocked`);
        t.status = "ready";
        break;
      case "changes":
        if (t.status !== "review") refuse(`cannot reopen ${id}: not in review`);
        t.thread.push({ id: t.thread.length + 1, author: by, body: a.text, at: Date.now() });
        t.status = "ready";
        break;
      case "archive": t.status = "archived"; break;
    }
    save();
    if (t.status === "ready") void dispatch(t, boardId);
    return taskView(t, team);
  }),
  // Hermes' skill library (all of it); installs are simulated in this browser.
  skills: api((profile?: string): SkillsView => ({ library: [...DEMO_LIBRARY], installed: profile ? [...(demoInstalled[profile] ?? [])] : [], seeded: !!profile, compiled: !!profile, skills: profile ? demoProfileSkills(profile) : [] })),
  installSkill: api((profile: string, id: string): { installed: string[] } => {
    const set = (demoInstalled[profile] ??= new Set());
    set.add(id.split("/").pop()!);
    return { installed: [...set].sort() };
  }),
  searchSkills: api((q: string): { results: SkillSearchResult[] } => {
    const w = q.trim().toLowerCase();
    return { results: DEMO_FOUND.filter((r) => `${r.name} ${r.description}`.toLowerCase().includes(w)) };
  }),
  addSkill: api((profile: string, source: string): { installed: string[]; skills: ProfileSkill[]; from: string } => {
    const name = source.replace(/\/SKILL\.md$/i, "").replace(/\/+$/, "").split("/").pop() || "skill";
    (demoInstalled[profile] ??= new Set()).add(name);
    return { installed: [...demoInstalled[profile]!].sort(), skills: demoProfileSkills(profile), from: source };
  }),
  pluginCatalog: api((): { plugins: CatalogPlugin[] } => ({ plugins: DEMO_PLUGINS })),
  plugins: api((profile: string): { compiled: boolean; installed: InstalledPlugin[] } => ({ compiled: true, installed: demoPlugins[profile] ?? [] })),
  pluginAct: api((profile: string, name: string, act: "install" | "enable" | "disable" | "remove"): { compiled: boolean; installed: InstalledPlugin[] } => {
    const list = (demoPlugins[profile] ??= []);
    const at = list.findIndex((p) => p.name === name);
    const entry = DEMO_PLUGINS.find((p) => p.name === name);
    if (act === "install" && at < 0) list.push({ name, enabled: true, version: entry?.version ?? "", summary: entry?.summary ?? "", source: `catalog:${entry?.tier ?? "community"}` });
    if ((act === "enable" || act === "disable") && at >= 0) list[at]!.enabled = act === "enable";
    if (act === "remove" && at >= 0) list.splice(at, 1);
    return { compiled: true, installed: [...list] };
  }),
  uninstallSkill: api((profile: string, name: string): { installed: string[]; skills: ProfileSkill[] } => {
    demoInstalled[profile]?.delete(name);
    return { installed: [...(demoInstalled[profile] ?? [])].sort(), skills: demoProfileSkills(profile) };
  }),
  updateSkill: api((profile: string, _name: string): { installed: string[]; skills: ProfileSkill[] } => ({ installed: [...(demoInstalled[profile] ?? [])].sort(), skills: demoProfileSkills(profile) })),
  // Simulated: the "browser" comes back signed in a moment later.
  signIn: api((profile: string, name: string): { started: boolean } => {
    demoSignIns.set(`${profile}/${name}`, { state: "waiting", error: null, at: Date.now() });
    setTimeout(() => demoSignIns.set(`${profile}/${name}`, { state: "done", error: null, at: Date.now() }), 2500);
    return { started: true };
  }),
  // The demo has no model to ask: the app makes the plan itself (graph/builder.ts quickPlan).
  builderPlan: api((_boardId: string, _request: string, _choices: PlanChoices): { plan: HarnessPlan; by: string } => {
    throw new EngineError(409, "The demo plans in the browser", {});
  }),
  update: api((): UpdateView => ({ current: "demo", latest: null, url: null, available: false })),
  signInState: api((profile: string, name: string): SignInView => demoSignIns.get(`${profile}/${name}`) ?? { state: "none", error: null, at: null }),
  schedules: api((boardId: string): AgentSchedules[] => [...teamOf(requireBoard(boardId))].map(([profile, agentNodeId]) => ({ agentNodeId, profile, schedules: demoSchedules()[profile] ?? [] }))),
  createSchedule: api((boardId: string, input: { profile: string; when: string; prompt: string; name: string }): AgentSchedules => {
    schedulesOf(requireBoard(boardId), input.profile);
    const preset = input.when === "0 9 * * *" || input.when === "0 9 * * 1-5";
    const list = (demoSchedules()[input.profile] ??= []);
    list.push({ id: Math.random().toString(16).slice(2, 14).padEnd(12, "0"), name: input.name, prompt: input.prompt, when: input.when, enabled: true, state: "scheduled",
      nextRunAt: preset ? nextNine(input.when.endsWith("1-5")) : null, lastRunAt: null, lastStatus: null, lastError: null });
    save();
    return schedulesOf(boardId, input.profile);
  }),
  actOnSchedule: api((boardId: string, profile: string, id: string, action: "pause" | "resume" | "run" | "remove"): AgentSchedules => {
    const list = demoSchedules()[profile] ?? [];
    const job = list.find((j) => j.id === id);
    if (!job) throw new EngineError(409, `Job not found: ${id}`, {});
    if (action === "remove") list.splice(list.indexOf(job), 1);
    if (action === "pause") Object.assign(job, { enabled: false, state: "paused" });
    if (action === "resume") Object.assign(job, { enabled: true, state: "scheduled" });
    if (action === "run") Object.assign(job, { lastRunAt: Date.now(), lastStatus: "ok" });
    save();
    return schedulesOf(requireBoard(boardId), profile);
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
  /** The demo can't look at other sites' headers; it says so for every site but localhost (BrowserView). */
  frameable: api((url: string) => ({ frameable: /^https?:\/\/(localhost|127\.0\.0\.1)/.test(url), url, reachable: true })),
  /** A pretend disk: the demo can't see the visitor's folders, so the picker shows a sample home. */
  browse: api((path: string | null): FsBrowse => {
    const home = "/Users/you";
    const tree: Record<string, string[]> = { [home]: ["Desktop", "Documents", "Downloads", "Projects"], [`${home}/Projects`]: ["support-desk"] };
    const at = path && tree[path.replace(/^~/, home)] ? path.replace(/^~/, home) : home;
    return {
      path: at, parent: at === home ? "/Users" : at.slice(0, at.lastIndexOf("/")),
      dirs: (tree[at] ?? []).map((name) => ({ name, path: `${at}/${name}` })),
      places: [{ name: "Home", path: home }, ...["Desktop", "Documents", "Downloads", "Projects"].map((name) => ({ name, path: `${home}/${name}` }))],
    };
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
    return { hermes: { found: true, path: "simulated in this browser", kind: "bundled" }, local: [{ name: "Ollama", baseUrl: DEMO_OLLAMA, models: DEMO_OLLAMA_MODELS }], secrets: [...secretNames] };
  }),
  // The simulated Ollama answers like setup found it, so Home doesn't say it isn't running.
  setupModels: api((baseUrl: string, _keyName?: string) => ({ models: baseUrl.replace(/\/+$/, "") === DEMO_OLLAMA ? [...DEMO_OLLAMA_MODELS] : null as string[] | null })),
  exportBoard: api((boardId: string): BoardExport => {
    const graph = graphOf(requireBoard(boardId));
    return { file: exportFileName(graph.name), path: null, shown: null, graph };
  }),
  importBoard: api((graph: unknown, fallbackName?: string): BoardInfo => {
    const g = graph as Partial<Graph> | null;
    if (!g || g.schema !== GRAPH_SCHEMA || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) throw new EngineError(400, "This file isn't a McBot board.", {});
    const name = ((typeof g.name === "string" && g.name.trim()) || fallbackName?.trim() || "Imported board").slice(0, 80);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "board";
    const b = { id: `${slug}-${Math.random().toString(16).slice(2, 6)}`, name };
    state.boards.push(b);
    (state.pending ??= {})[b.id] = { ...(g as Graph), id: b.id, name };
    save();
    return b;
  }),
  /** The demo has no ~/.hermes: the real reader runs on a sample Hermes setup instead. */
  openHermes: api((_path?: string) => {
    const name = "My Hermes";
    const b = { id: `my-hermes-${Math.random().toString(16).slice(2, 6)}`, name };
    const { graph, unshown } = readHermes(b, SAMPLE_HERMES);
    const note = unshownNote(unshown, Date.now());
    state.boards.push(b);
    (state.pending ??= {})[b.id] = note ? { ...graph, notes: [note] } : graph;
    save();
    return { ...b, unshown };
  }),
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
  removeSecret: api((name: string) => {
    secretNames.delete(name);
    return { names: [...secretNames] };
  }),
  setSecret: api((name: string, value: string) => {
    if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(name) || !value.trim()) throw new EngineError(400, "That key doesn't look right", {});
    secretNames.add(name);
    return { names: [...secretNames] };
  }),
  read: api((root: string, path: string): FsPreview => {
    const { files } = filesOf(root);
    const text = files[path];
    if (text === undefined) throw new EngineError(404, "no such file", {});
    return { path, bytes: utf8Bytes(text).length, text, sha256: sha256Hex(text) };
  }),
  /** The code editor's save, in this browser only (the shared files and the sample project). */
  writeFile: api((root: string, path: string, text: string, baseSha256: string | null) => {
    if (root.startsWith("profile:")) return saveAgentFile(root.slice(8), path, text, baseSha256);
    const { files } = filesOf(root);
    const current = files[path];
    if ((current === undefined ? null : sha256Hex(current)) !== baseSha256) throw new EngineError(409, "The file changed since you opened it. Reopen it to see the change.", {});
    files[path] = text;
    return { path, bytes: utf8Bytes(text).length, sha256: sha256Hex(text) };
  }),
};

/** An agent's settings saved in the Code view: the file changes, and the board follows (as in the app). */
function saveAgentFile(profile: string, path: string, text: string, baseSha256: string | null) {
  if (!agentEditable(path) || path.startsWith("workspace/")) throw new EngineError(403, "In the demo, an agent's settings files can be edited, not its other folders", {});
  const full = `profiles/${profile}/${path}`;
  const current = state.disk[full];
  if ((current === undefined ? null : sha256Hex(current)) !== baseSha256) throw new EngineError(409, "The file changed since you opened it. Reopen it to see the change.", {});
  const files = (): ProfileFiles => {
    const dir = `profiles/${profile}/`;
    const skills: Record<string, string> = {};
    for (const [p, body] of Object.entries(state.disk)) {
      const m = /^skills\/([^/]+)\/SKILL\.md$/.exec(p.slice(dir.length));
      if (p.startsWith(dir) && m) skills[m[1]!] = body;
    }
    return { name: profile, config: state.disk[`${dir}config.yaml`] ?? null, soul: state.disk[`${dir}SOUL.md`] ?? null, profileYaml: state.disk[`${dir}profile.yaml`] ?? null, skills };
  };
  const base = files();
  state.disk[full] = text;
  const boardId = manifest()?.graphId ?? "";
  let followed: string[] = [];
  const doc = docs.get(boardId);
  if (doc) {
    const { edits, changed } = followChanges(graphFromDoc(doc), base, files());
    applyToDoc(doc, edits);
    followed = edits.length ? changed : [];
  }
  save();
  return { path, bytes: utf8Bytes(text).length, sha256: sha256Hex(text), followed };
}

export function subscribeDemoEvents(onEvent: Listener, onStatus?: (connected: boolean) => void): () => void {
  listeners.add(onEvent);
  onStatus?.(true);
  return () => listeners.delete(onEvent);
}

/** A small ~/.hermes for the demo's "Open my Hermes setup": a lead who hands work to a coder. */
const SAMPLE_HERMES: ProfileFiles[] = [
  {
    name: "lead",
    config: "model:\n  provider: custom:mcbot-local\n  default: qwen3:8b\nproviders:\n  mcbot-local:\n    api: http://127.0.0.1:11434/v1\n    default_model: qwen3:8b\n    transport: chat_completions\nplatform_toolsets:\n  cli:\n    - web\n    - browser\n    - memory\n    - kanban\nmemory:\n  provider: holographic\n",
    soul: "# Lead\n\nPlans the week and hands the code to the coder.\n\n## Team\n\nYou can hand work to these agents.\n\n- `coder` (Coder): writes and reviews code\n",
    profileYaml: "display_name: Lead\ndescription: Plans the week\n",
    skills: {},
  },
  {
    name: "coder",
    config: "model:\n  provider: custom:mcbot-local\n  default: qwen3:8b\nproviders:\n  mcbot-local:\n    api: http://127.0.0.1:11434/v1\n    default_model: qwen3:8b\n    transport: chat_completions\nmcp_servers:\n  git:\n    command: uvx\n    args:\n      - mcp-server-git\n",
    soul: "# Coder\n\nWrites small, tested changes.\n",
    profileYaml: "display_name: Coder\ndescription: Writes and reviews code\n",
    skills: {
      review: "---\nname: review\ndescription: Review a diff before it ships\nversion: 1.0.0\n---\n\nRead the whole diff, run the tests, say what breaks.\n",
      "software-development": "",
    },
  },
];
