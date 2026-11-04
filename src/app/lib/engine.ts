/** Thin client for the local engine (engine/server.ts). */
import type { AgentMemoryView, BoardInfo, CompileResponse, CostReport, FileEntry, Health, MemoryFileView } from "../../contracts/api";
import type { RunEvent, RunSummary } from "../../contracts/run";

/** The Tauri production webview has no dev proxy; everything else (Vite, Tauri dev) does. */
const direct = typeof location !== "undefined" && (location.protocol === "tauri:" || location.hostname === "tauri.localhost");
export const ENGINE_HTTP = direct ? "http://127.0.0.1:4317" : "";
export const ENGINE_WS = direct ? "ws://127.0.0.1:4317" : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;

export class EngineError extends Error {
  constructor(readonly status: number, message: string, readonly body: Record<string, unknown>) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${ENGINE_HTTP}${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new EngineError(0, "The McBot engine is not reachable. Start it with `npm run engine`.", {});
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new EngineError(res.status, String(data.error ?? res.statusText), data);
  return data as T;
}

export const engine = {
  health: () => call<Health>("GET", "/api/health"),
  boards: () => call<BoardInfo[]>("GET", "/api/boards"),
  createBoard: (name: string) => call<BoardInfo>("POST", "/api/boards", { name }),
  compile: (boardId: string) => call<CompileResponse>("POST", "/api/compile", { boardId }),
  preview: (boardId: string) => call<CompileResponse>("GET", `/api/compile?boardId=${encodeURIComponent(boardId)}`),
  runs: (boardId: string) => call<RunSummary[]>("GET", `/api/runs?boardId=${encodeURIComponent(boardId)}`),
  run: (runId: string) => call<RunEvent[]>("GET", `/api/runs/${runId}`),
  startRun: (boardId: string, agentNodeId: string, prompt: string) => call<{ runId: string }>("POST", "/api/runs", { boardId, agentNodeId, prompt }),
  cancelRun: (runId: string) => call<{ cancelled: boolean }>("POST", `/api/runs/${runId}/cancel`, {}),
  memory: (boardId: string) => call<AgentMemoryView[]>("GET", `/api/memory?boardId=${encodeURIComponent(boardId)}`),
  saveMemory: (profile: string, target: "memory" | "user", entries: string[], baseSha256: string | null) =>
    call<MemoryFileView>("PUT", "/api/memory", { profile, target, entries, baseSha256 }),
  cost: (boardId: string) => call<CostReport>("GET", `/api/cost?boardId=${encodeURIComponent(boardId)}`),
  files: (boardId: string) => call<{ profile: string; nodeId: string; files: FileEntry[] }[]>("GET", `/api/files?boardId=${encodeURIComponent(boardId)}`),
  file: (path: string) => call<{ path: string; bytes: number; text: string | null; reason?: string }>("GET", `/api/file?path=${encodeURIComponent(path)}`),
};

/** Live run events for every run, from the engine's SSE stream. Reconnects on its own. */
export function subscribeRunEvents(onEvent: (e: RunEvent) => void, onStatus?: (connected: boolean) => void): () => void {
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
