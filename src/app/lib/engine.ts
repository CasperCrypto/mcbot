/** Thin client for the local engine (engine/server.ts). */
import type { AgentMemoryView, BoardExport, BoardInfo, CompileResponse, CostReport, Diagnostics, FsListing, FsPreview, FsRoot, Health, HermesInfo, MemoryFileView, AgentSchedules, SetupDetect, SetupProfile, SetupState, SharingView, TaskAction, TaskDetail, TasksView, TaskView } from "../../contracts/api";
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

import { demoEngine, subscribeDemoEvents } from "../demo/engine";
import { EngineError } from "./engineError";

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
  runs: (boardId: string) => call<RunSummary[]>("GET", `/api/runs?boardId=${encodeURIComponent(boardId)}`),
  run: (runId: string) => call<RunEvent[]>("GET", `/api/runs/${runId}`),
  startRun: (boardId: string, agentNodeId: string, prompt: string) => call<{ runId: string }>("POST", "/api/runs", { boardId, agentNodeId, prompt }),
  answerRun: (runId: string, choice: string) => call<{ answered: string }>("POST", `/api/runs/${runId}/approval`, { choice }),
  cancelRun: (runId: string) => call<{ cancelled: boolean }>("POST", `/api/runs/${runId}/cancel`, {}),
  memory: (boardId: string) => call<AgentMemoryView[]>("GET", `/api/memory?boardId=${encodeURIComponent(boardId)}`),
  saveMemory: (profile: string, target: "memory" | "user", entries: string[], baseSha256: string | null) =>
    call<MemoryFileView>("PUT", "/api/memory", { profile, target, entries, baseSha256 }),
  cost: (boardId: string) => call<CostReport>("GET", `/api/cost?boardId=${encodeURIComponent(boardId)}`),
  roots: (boardId: string) => call<FsRoot[]>("GET", `/api/fs/roots?boardId=${encodeURIComponent(boardId)}`),
  openFolder: (path: string) => call<FsRoot>("POST", "/api/fs/roots", { path }),
  closeFolder: (id: string) => call<{ ok: true }>("POST", "/api/fs/roots/close", { id }),
  list: (root: string, path: string) => call<FsListing>("GET", `/api/fs/list?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`),
  writeFile: (root: string, path: string, text: string, baseSha256: string | null) => call<{ path: string; bytes: number; sha256: string }>("PUT", "/api/fs/write", { root, path, text, baseSha256 }),
  read: (root: string, path: string) => call<FsPreview>("GET", `/api/fs/read?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`),
  setup: () => call<SetupState>("GET", "/api/setup"),
  setupDetect: () => call<SetupDetect>("GET", "/api/setup/detect"),
  setupModels: (baseUrl: string, keyName?: string) => call<{ models: string[] | null }>("POST", "/api/setup/models", { baseUrl, keyName }),
  setupBoard: (name: string, graph: Graph) => call<BoardInfo>("POST", "/api/setup/board", { name, graph }),
  setupComplete: (profile: SetupProfile | null) => call<SetupState>("POST", "/api/setup/complete", { profile }),
  setSecret: (name: string, value: string) => call<{ names: string[] }>("POST", "/api/secrets", { name, value }),
  secrets: () => call<{ names: string[] }>("GET", "/api/secrets"),
  media: (profile: string, path: string) => blob(`/api/media?profile=${encodeURIComponent(profile)}&path=${encodeURIComponent(path)}`),
  hermes: () => call<HermesInfo>("GET", "/api/hermes"),
  restartGateway: () => call<HermesInfo>("POST", "/api/hermes/gateway/restart", {}),
  prepareHermes: () => call<HermesInfo>("POST", "/api/hermes/prepare", {}),
  diagnostics: () => call<Diagnostics>("GET", "/api/diagnostics"),
  share: () => call<SharingView>("GET", "/api/share"),
  setShare: (on: boolean) => call<SharingView>("POST", "/api/share", { on }),
  newInvite: () => call<SharingView>("POST", "/api/share/invite", {}),
  removeMember: (id: string) => call<SharingView>("POST", "/api/share/remove", { id }),
  tasks: (boardId: string) => call<TasksView>("GET", `/api/tasks?boardId=${encodeURIComponent(boardId)}`),
  task: (boardId: string, id: string) => call<TaskDetail>("GET", `/api/tasks/one?boardId=${encodeURIComponent(boardId)}&id=${encodeURIComponent(id)}`),
  createTask: (boardId: string, t: { title: string; body: string; assignee: string | null; by: string; parents?: string[] }) => call<TaskView>("POST", "/api/tasks", { boardId, ...t }),
  schedules: (boardId: string) => call<AgentSchedules[]>("GET", `/api/schedules?boardId=${encodeURIComponent(boardId)}`),
  createSchedule: (boardId: string, s: { profile: string; when: string; prompt: string; name: string }) => call<AgentSchedules>("POST", "/api/schedules", { boardId, ...s }),
  actOnSchedule: (boardId: string, profile: string, id: string, action: "pause" | "resume" | "run" | "remove") => call<AgentSchedules>("POST", "/api/schedules/act", { boardId, profile, id, action }),
  actOnTask: (boardId: string, id: string, by: string, a: TaskAction) => call<TaskDetail>("POST", "/api/tasks/act", { boardId, id, by, ...a }),
};

export const engine: typeof http = DEMO ? demoEngine : http;

/** Live run events for every run, from the engine's SSE stream. Reconnects on its own. */
export function subscribeRunEvents(onEvent: (e: RunEvent) => void, onStatus?: (connected: boolean) => void): () => void {
  if (DEMO) return subscribeDemoEvents(onEvent, onStatus);
  const es = new EventSource(`${ENGINE_HTTP}/api/events${REMOTE ? `?key=${encodeURIComponent(REMOTE.key)}` : ""}`);
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
