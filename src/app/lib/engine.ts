/** Thin client for the local engine (engine/server.ts). */
import type { CatalogPlugin, InstalledPlugin, ProfileSkill, SkillSearchResult, SkillsView, AgentMemoryView, BoardExport, BoardInfo, CompileResponse, CostReport, Diagnostics, FsBrowse, FsListing, FsPreview, FsRoot, Health, HermesInfo, MemoryFileView, AgentSchedules, SetupDetect, SetupProfile, SetupState, SharingView, GuestView, GitHubRepoView, LoginView, SignInView, TaskAction, UpdateView, TaskDetail, TasksView, TaskView, LearnExport, LearnView, DocUpload, TrainJob } from "../../contracts/api";
import type { HarnessVersion } from "../../harness/versions";
import type { Graph } from "../../contracts/graph";
import type { RunEvent, RunSummary } from "../../contracts/run";

import { loadRemote } from "./remote";

/** The Tauri production webview has no dev proxy; everything else (Vite, Tauri dev) does. */
const direct = typeof location !== "undefined" && (location.protocol === "tauri:" || location.hostname === "tauri.localhost");
/** A board shared from another computer this window joined, or null for this computer's own engine. */
export const REMOTE = typeof localStorage !== "undefined" ? loadRemote() : null;
export const ENGINE_HTTP = REMOTE ? REMOTE.url : direct ? "http://127.0.0.1:4317" : "";
export const ENGINE_WS = REMOTE ? REMOTE.url.replace(/^http/, "ws") : direct ? "ws://127.0.0.1:4317" : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
/** A member key goes with every request to a shared engine. */
const auth = (): Record<string, string> => (REMOTE ? { authorization: `Bearer ${REMOTE.key}` } : {});

import type { HarnessPlan, PlanChoices } from "../../harness/plan";
import { demoEngine, subscribeDemoEvents } from "../demo/engine";
import { EngineError } from "./engineError";
import type { DatasetFormat, DatasetPick, Rating } from "../../harness/learn";

export { EngineError };

/** Browser-only build (`npm run build:demo`): the engine runs in the page, runs are simulated. */
export const DEMO = import.meta.env.VITE_MCBOT_DEMO === "1";

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${ENGINE_HTTP}${path}`, {
      method,
      headers: { ...auth(), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new EngineError(0, "The McBot engine is not reachable. Start it with `npm run engine`.", {});
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new EngineError(res.status, String(data.error ?? res.statusText), data);
  return data as T;
}

/** Send a file's bytes as the body (a document for the agents). */
async function upload<T>(path: string, data: Blob): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${ENGINE_HTTP}${path}`, { method: "POST", headers: { ...auth(), "content-type": "application/octet-stream" }, body: data });
  } catch {
    throw new EngineError(0, "The McBot engine is not reachable.", {});
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new EngineError(res.status, String(body.error ?? res.statusText), body);
  return body as T;
}

/** A file the engine streams as itself (images and videos agents made). */
async function blob(path: string): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(`${ENGINE_HTTP}${path}`, { headers: auth() });
  } catch {
    throw new EngineError(0, "The McBot engine is not reachable.", {});
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new EngineError(res.status, String(data.error ?? res.statusText), data);
  }
  return res.blob();
}

const http = {
  health: () => call<Health>("GET", "/api/health"),
  boards: () => call<BoardInfo[]>("GET", "/api/boards"),
  createBoard: (name: string) => call<BoardInfo>("POST", "/api/boards", { name }),
  exportBoard: (boardId: string) => call<BoardExport>("POST", "/api/boards/export", { boardId }),
  /** Open a Hermes setup on this computer (default ~/.hermes) as a new board. */
  openHermes: (path?: string) => call<BoardInfo & { unshown: { profile: string; what: string; why: string }[] }>("POST", "/api/boards/from-hermes", { path }),
  importBoard: (graph: unknown, fallbackName?: string) => call<BoardInfo>("POST", "/api/boards/import", { graph, fallbackName }),
  compile: (boardId: string) => call<CompileResponse>("POST", "/api/compile", { boardId }),
  preview: (boardId: string) => call<CompileResponse>("GET", `/api/compile?boardId=${encodeURIComponent(boardId)}`),
  /** The board's harness versions (one per compile that changed it), oldest first. */
  versions: (boardId: string) => call<{ versions: HarnessVersion[] }>("GET", `/api/versions?boardId=${encodeURIComponent(boardId)}`),
  nameVersion: (boardId: string, id: string, name: string) => call<{ versions: HarnessVersion[] }>("POST", "/api/versions/name", { boardId, id, name }),
  runs: (boardId: string) => call<RunSummary[]>("GET", `/api/runs?boardId=${encodeURIComponent(boardId)}`),
  run: (runId: string) => call<RunEvent[]>("GET", `/api/runs/${runId}`),
  startRun: (boardId: string, agentNodeId: string, prompt: string) => call<{ runId: string }>("POST", "/api/runs", { boardId, agentNodeId, prompt }),
  answerRun: (runId: string, choice: string) => call<{ answered: string }>("POST", `/api/runs/${runId}/approval`, { choice }),
  /** Training in the cloud: the board's jobs (their state asked of the provider), start one, cancel one. */
  trainJobs: (boardId: string) => call<TrainJob[]>("GET", `/api/train?boardId=${encodeURIComponent(boardId)}`),
  startTraining: (boardId: string, agentNodeId: string, modelNodeId: string, baseModel: string, pick: DatasetPick) => call<TrainJob>("POST", "/api/train", { boardId, agentNodeId, modelNodeId, baseModel, pick }),
  cancelTraining: (id: string) => call<TrainJob>("POST", "/api/train/cancel", { id }),
  /** A document for the agents: kept in files/knowledge, read to text (PDF and Office files by Hermes). */
  addDoc: (name: string, data: Blob) => upload<DocUpload>(`/api/knowledge/doc?name=${encodeURIComponent(name)}`, data),
  /** The board's knowledge as Markdown, saved in <workspace>/exports (never over an earlier file). */
  exportKnowledge: (boardId: string, markdown: string) => call<{ path: string }>("POST", "/api/knowledge/export", { boardId, markdown }),
  /** Answer what the agent asked (approvals/question.ts encodeAnswer). */
  replyRun: (runId: string, promptId: string, answer: string) => call<{ answered: string }>("POST", `/api/runs/${runId}/reply`, { promptId, answer }),
  cancelRun: (runId: string) => call<{ cancelled: boolean }>("POST", `/api/runs/${runId}/cancel`, {}),
  memory: (boardId: string) => call<AgentMemoryView[]>("GET", `/api/memory?boardId=${encodeURIComponent(boardId)}`),
  saveMemory: (profile: string, target: "memory" | "user", entries: string[], baseSha256: string | null) =>
    call<MemoryFileView>("PUT", "/api/memory", { profile, target, entries, baseSha256 }),
  cost: (boardId: string) => call<CostReport>("GET", `/api/cost?boardId=${encodeURIComponent(boardId)}`),
  ratings: (boardId: string) => call<Record<string, Rating>>("GET", `/api/ratings?boardId=${encodeURIComponent(boardId)}`),
  rate: (runId: string, score: 0 | 1 | null, note?: string) => call<{ runId: string; rating: Rating | null }>("POST", "/api/ratings", { runId, score, ...(note ? { note } : {}) }),
  learn: (boardId: string) => call<LearnView>("GET", `/api/learn?boardId=${encodeURIComponent(boardId)}`),
  exportDataset: (boardId: string, agentNodeId: string, format: DatasetFormat, pick: DatasetPick) => call<LearnExport>("POST", "/api/learn/export", { boardId, agentNodeId, format, pick }),
  roots: (boardId: string) => call<FsRoot[]>("GET", `/api/fs/roots?boardId=${encodeURIComponent(boardId)}`),
  openFolder: (path: string) => call<FsRoot>("POST", "/api/fs/roots", { path }),
  browse: (path: string | null) => call<FsBrowse>("GET", `/api/fs/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`),
  frameable: (url: string) => call<{ frameable: boolean; url: string; reachable?: boolean }>("GET", `/api/web/frameable?url=${encodeURIComponent(url)}`),
  closeFolder: (id: string) => call<{ ok: true }>("POST", "/api/fs/roots/close", { id }),
  list: (root: string, path: string) => call<FsListing>("GET", `/api/fs/list?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`),
  writeFile: (root: string, path: string, text: string, baseSha256: string | null) => call<{ path: string; bytes: number; sha256: string; followed?: string[] }>("PUT", "/api/fs/write", { root, path, text, baseSha256 }),
  read: (root: string, path: string) => call<FsPreview>("GET", `/api/fs/read?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`),
  setup: () => call<SetupState>("GET", "/api/setup"),
  setupDetect: () => call<SetupDetect>("GET", "/api/setup/detect"),
  setupModels: (baseUrl: string, keyName?: string) => call<{ models: string[] | null }>("POST", "/api/setup/models", { baseUrl, keyName }),
  setupBoard: (name: string, graph: Graph) => call<BoardInfo>("POST", "/api/setup/board", { name, graph }),
  setupComplete: (profile: SetupProfile | null) => call<SetupState>("POST", "/api/setup/complete", { profile }),
  setSecret: (name: string, value: string) => call<{ names: string[] }>("POST", "/api/secrets", { name, value }),
  secrets: () => call<{ names: string[] }>("GET", "/api/secrets"),
  removeSecret: (name: string) => call<{ names: string[] }>("POST", "/api/secrets/remove", { name }),
  media: (profile: string, path: string) => blob(`/api/media?profile=${encodeURIComponent(profile)}&path=${encodeURIComponent(path)}`),
  hermes: () => call<HermesInfo>("GET", "/api/hermes"),
  restartGateway: () => call<HermesInfo>("POST", "/api/hermes/gateway/restart", {}),
  prepareHermes: () => call<HermesInfo>("POST", "/api/hermes/prepare", {}),
  diagnostics: () => call<Diagnostics>("GET", "/api/diagnostics"),
  share: () => call<SharingView>("GET", "/api/share"),
  setShare: (on: boolean, reach?: "network" | "internet") => call<SharingView>("POST", "/api/share", { on, ...(reach ? { reach } : {}) }),
  /** Who links reach: this network, or anyone with the link (a free tunnel, or `ownUrl`). */
  setShareReach: (reach: "network" | "internet", ownUrl?: string | null) => call<SharingView>("POST", "/api/share/reach", { reach, ...(ownUrl === undefined ? {} : { ownUrl }) }),
  /** A new link: teammates (edit), or guests who chat with some agents of a board. */
  newInvite: (scope?: { role: "edit" | "chat"; boardId?: string; agents?: string[] }) => call<SharingView>("POST", "/api/share/invite", scope ?? {}),
  removeMember: (id: string) => call<SharingView>("POST", "/api/share/remove", { id }),
  /** Someone who joined: whose McBot it is, and a guest's agents. */
  guest: () => call<GuestView>("GET", "/api/guest"),
  /** Add from GitHub: what a repository is, a plugin from it for an agent, or its files in the shared folder. */
  githubInspect: (url: string) => call<GitHubRepoView>("GET", `/api/github/inspect?url=${encodeURIComponent(url)}`),
  githubPlugin: (profile: string, source: string) => call<{ installed: string }>("POST", "/api/github/plugin", { profile, source }),
  githubDownload: (url: string) => call<{ folder: string; path: string }>("POST", "/api/github/download", { url }),
  /** Passwords: the person's logins (no passwords in lists), saved, removed, revealed for copy or fill. */
  logins: (host?: string) => call<{ logins: LoginView[] }>("GET", `/api/logins${host ? `?host=${encodeURIComponent(host)}` : ""}`),
  saveLogin: (l: { id?: string; url: string; username: string; password?: string; note?: string }) => call<{ login: LoginView; logins: LoginView[] }>("POST", "/api/logins", l),
  removeLogin: (id: string) => call<{ logins: LoginView[] }>("POST", "/api/logins/remove", { id }),
  revealLogin: (id: string) => call<{ username: string; password: string; host: string }>("POST", "/api/logins/reveal", { id }),
  tasks: (boardId: string) => call<TasksView>("GET", `/api/tasks?boardId=${encodeURIComponent(boardId)}`),
  task: (boardId: string, id: string) => call<TaskDetail>("GET", `/api/tasks/one?boardId=${encodeURIComponent(boardId)}&id=${encodeURIComponent(id)}`),
  createTask: (boardId: string, t: { title: string; body: string; assignee: string | null; by: string; parents?: string[]; goal?: boolean }) => call<TaskView>("POST", "/api/tasks", { boardId, ...t }),
  schedules: (boardId: string) => call<AgentSchedules[]>("GET", `/api/schedules?boardId=${encodeURIComponent(boardId)}`),
  createSchedule: (boardId: string, s: { profile: string; when: string; prompt: string; name: string }) => call<AgentSchedules>("POST", "/api/schedules", { boardId, ...s }),
  actOnSchedule: (boardId: string, profile: string, id: string, action: "pause" | "resume" | "run" | "remove") => call<AgentSchedules>("POST", "/api/schedules/act", { boardId, profile, id, action }),
  skills: (profile?: string) => call<SkillsView>("GET", `/api/skills${profile ? `?profile=${encodeURIComponent(profile)}` : ""}`),
  installSkill: (profile: string, id: string) => call<{ installed: string[] }>("POST", "/api/skills/install", { profile, id }),
  searchSkills: (q: string) => call<{ results: SkillSearchResult[] }>("GET", `/api/skills/search?q=${encodeURIComponent(q)}`),
  addSkill: (profile: string, source: string) => call<{ installed: string[]; skills: ProfileSkill[]; from: string }>("POST", "/api/skills/add", { profile, source }),
  pluginCatalog: () => call<{ plugins: CatalogPlugin[] }>("GET", "/api/plugins/catalog"),
  plugins: (profile: string) => call<{ compiled: boolean; installed: InstalledPlugin[] }>("GET", `/api/plugins?profile=${encodeURIComponent(profile)}`),
  pluginAct: (profile: string, name: string, act: "install" | "enable" | "disable" | "remove") => call<{ compiled: boolean; installed: InstalledPlugin[] }>("POST", "/api/plugins/act", { profile, name, act }),
  uninstallSkill: (profile: string, name: string) => call<{ installed: string[]; skills: ProfileSkill[] }>("POST", "/api/skills/uninstall", { profile, name }),
  updateSkill: (profile: string, name: string) => call<{ installed: string[]; skills: ProfileSkill[] }>("POST", "/api/skills/update", { profile, name }),
  signIn: (profile: string, name: string) => call<{ started: boolean }>("POST", "/api/connectors/login", { profile, name }),
  update: () => call<UpdateView>("GET", "/api/update"),
  builderPlan: (boardId: string, request: string, choices: PlanChoices) => call<{ plan: HarnessPlan; by: string }>("POST", "/api/builder/plan", { boardId, request, choices }),
  signInState: (profile: string, name: string) => call<SignInView>("GET", `/api/connectors/login?profile=${encodeURIComponent(profile)}&name=${encodeURIComponent(name)}`),
  actOnTask: (boardId: string, id: string, by: string, a: TaskAction) => call<TaskDetail>("POST", "/api/tasks/act", { boardId, id, by, ...a }),
};

const base: typeof http = DEMO ? demoEngine : http;

/** Saved keys changed in this window (one saved or removed): what checks keys asks again. */
const keyListeners = new Set<() => void>();
export function onKeysChanged(run: () => void): () => void {
  keyListeners.add(run);
  return () => { keyListeners.delete(run); };
}
const tellKeys = <A extends unknown[], T>(f: (...a: A) => Promise<T>) => (...a: A) => f(...a).then((v) => { for (const l of keyListeners) l(); return v; });

export const engine: typeof http = { ...base, setSecret: tellKeys(base.setSecret), removeSecret: tellKeys(base.removeSecret) };

/** An agent's files changed in Hermes and the board followed (engine/hermesSync.ts). */
export interface HarnessChange { boardId: string; agent: string; changed: string[] }

/**
 * A window that joined another computer gets its events over a WebSocket: a Cloudflare quick tunnel
 * carries no Server-Sent Events. One socket, shared by every listener, reconnecting on its own.
 */
type Frame = { run?: RunEvent; harness?: HarnessChange };
const listeners = new Set<(f: Frame) => void>();
const statusListeners = new Set<(up: boolean) => void>();
let socket: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
function openSocket(): void {
  if (socket || !REMOTE) return;
  const ws = new WebSocket(`${ENGINE_WS}/api/events?key=${encodeURIComponent(REMOTE.key)}`);
  socket = ws;
  ws.onopen = () => { for (const l of statusListeners) l(true); };
  ws.onmessage = (m) => {
    if (socket !== ws) return;
    try {
      const f = JSON.parse(String(m.data)) as Frame;
      if (f.run || f.harness) for (const l of listeners) l(f);
    } catch {
      /* a malformed frame is skipped */
    }
  };
  ws.onclose = () => {
    // An old socket closing late must not drop the one that replaced it.
    if (socket !== ws) return;
    socket = null;
    for (const l of statusListeners) l(false);
    if (listeners.size && !retry) retry = setTimeout(() => { retry = null; openSocket(); }, 2000);
  };
}
function listen(onFrame: (f: Frame) => void, onStatus?: (up: boolean) => void): () => void {
  listeners.add(onFrame);
  if (onStatus) statusListeners.add(onStatus);
  openSocket();
  if (onStatus && socket?.readyState === WebSocket.OPEN) onStatus(true);
  return () => {
    listeners.delete(onFrame);
    if (onStatus) statusListeners.delete(onStatus);
    if (!listeners.size) {
      const ws = socket;
      socket = null;
      ws?.close();
    }
  };
}

export function subscribeHarness(onChange: (c: HarnessChange) => void): () => void {
  if (DEMO) return () => undefined;
  if (REMOTE) return listen((f) => { if (f.harness) onChange(f.harness); });
  const es = new EventSource(`${ENGINE_HTTP}/api/events`);
  es.addEventListener("harness", (m) => {
    try {
      onChange(JSON.parse((m as MessageEvent<string>).data) as HarnessChange);
    } catch {
      /* skipped */
    }
  });
  return () => es.close();
}

/** Live run events for every run, from the engine's SSE stream. Reconnects on its own. */
export function subscribeRunEvents(onEvent: (e: RunEvent) => void, onStatus?: (connected: boolean) => void): () => void {
  if (DEMO) return subscribeDemoEvents(onEvent, onStatus);
  if (REMOTE) return listen((f) => { if (f.run) onEvent(f.run); }, onStatus);
  const es = new EventSource(`${ENGINE_HTTP}/api/events`);
  es.onopen = () => onStatus?.(true);
  es.onerror = () => onStatus?.(false);
  es.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data) as RunEvent);
    } catch {
      /* a malformed frame is skipped, the stream continues */
    }
  };
  return () => es.close();
}
