import { create } from "zustand";
import type { BoardInfo, CompileResponse, Health, SetupState } from "../../contracts/api";
import { summarizeRun, type RunEvent, type RunSummary } from "../../contracts/run";
import { loadIdentity, saveIdentity, type Identity } from "../lib/identity";

export type Tab = "home" | "graph" | "agents" | "tasks" | "code" | "browser" | "workflows" | "memory" | "files" | "cost" | "team";

export interface Toast {
  id: number;
  kind: "ok" | "fail" | "info";
  text: string;
  action?: { label: string; run: () => void };
}

interface State {
  tab: Tab;
  boardId: string | null;
  boards: BoardInfo[];
  health: Health | null;
  engineUp: boolean | null;
  identity: Identity;
  selectedNodeId: string | null;
  selectedRunId: string | null;
  compileOpen: boolean;
  compileBusy: boolean;
  compile: CompileResponse | null;
  /** Files the board would change if compiled now (null = unknown). */
  drift: number | null;
  events: Record<string, RunEvent[]>;
  runs: Record<string, RunSummary>;
  toasts: Toast[];
  paletteOpen: boolean;
  /** The Hermes runtime sheet. */
  hermesOpen: boolean;
  /** Report a problem. */
  reportOpen: boolean;
  /** The New agent sheet. */
  newAgentOpen: boolean;
  /** The tool catalog. */
  catalogOpen: boolean;
  /** A sticky note this window just made: it opens ready to type. */
  freshNote: string | null;
  /** The agent whose thread is open in Agents. */
  chatAgentId: string | null;
  /** The task open in Tasks, or "new" for the new-task form. */
  openTask: string | null;
  /** First-launch setup: null until the engine answers. */
  setup: SetupState | null;

  setTab(tab: Tab): void;
  setPalette(open: boolean): void;
  setHermesOpen(open: boolean): void;
  setReportOpen(open: boolean): void;
  setNewAgentOpen(open: boolean): void;
  setCatalogOpen(open: boolean): void;
  setFreshNote(id: string | null): void;
  openChat(agentNodeId: string | null): void;
  showTask(id: string | null, tab?: boolean): void;
  setSetup(setup: SetupState | null): void;
  setBoard(id: string | null): void;
  setBoards(b: BoardInfo[]): void;
  setHealth(h: Health | null, up: boolean): void;
  setIdentity(id: Identity): void;
  select(nodeId: string | null): void;
  selectRun(runId: string | null): void;
  setCompile(patch: Partial<Pick<State, "compileOpen" | "compileBusy" | "compile" | "drift">>): void;
  loadRuns(list: RunSummary[]): void;
  loadEvents(runId: string, events: RunEvent[]): void;
  applyEvent(e: RunEvent): void;
  toast(t: Omit<Toast, "id">): void;
  dismiss(id: number): void;
}

let toastId = 0;
const BOARD_KEY = "mcbot.board";

function savedBoard(): string | null {
  try {
    return localStorage.getItem(BOARD_KEY);
  } catch {
    return null;
  }
}

export const useApp = create<State>((set, get) => ({
  tab: "home",
  boardId: savedBoard(),
  boards: [],
  health: null,
  engineUp: null,
  identity: loadIdentity(),
  selectedNodeId: null,
  selectedRunId: null,
  compileOpen: false,
  compileBusy: false,
  compile: null,
  drift: null,
  events: {},
  runs: {},
  toasts: [],
  paletteOpen: false,
  chatAgentId: null,

  setTab: (tab) => set({ tab }),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  hermesOpen: false,
  setHermesOpen: (hermesOpen) => set({ hermesOpen, paletteOpen: false }),
  reportOpen: false,
  setReportOpen: (reportOpen) => set({ reportOpen, paletteOpen: false }),
  newAgentOpen: false,
  setNewAgentOpen: (newAgentOpen) => set({ newAgentOpen, paletteOpen: false }),
  catalogOpen: false,
  freshNote: null,
  setFreshNote: (freshNote) => set({ freshNote }),
  setCatalogOpen: (catalogOpen) => set({ catalogOpen, paletteOpen: false }),
  openChat: (chatAgentId) => set({ chatAgentId, tab: "agents" }),
  openTask: null,
  showTask: (openTask, tab = true) => set(tab ? { openTask, tab: "tasks", paletteOpen: false } : { openTask }),
  setup: null,
  setSetup: (setup) => set({ setup }),
  setBoard: (boardId) => {
    try {
      if (boardId) localStorage.setItem(BOARD_KEY, boardId);
    } catch {
      /* remembered for this session only */
    }
    set({ boardId, selectedNodeId: null, selectedRunId: null, chatAgentId: null, openTask: null, compile: null, compileOpen: false, drift: null, events: {}, runs: {} });
  },
  setBoards: (boards) => set({ boards }),
  setHealth: (health, engineUp) => set({ health, engineUp }),
  setIdentity: (identity) => {
    saveIdentity(identity);
    set({ identity });
  },
  select: (selectedNodeId) => set({ selectedNodeId }),
  selectRun: (selectedRunId) => set({ selectedRunId }),
  setCompile: (patch) => set(patch),
  loadRuns: (list) => set((s) => ({ runs: { ...Object.fromEntries(list.map((r) => [r.runId, r])), ...liveOnly(s.runs, list) } })),
  loadEvents: (runId, events) =>
    set((s) => {
      const summary = summarizeRun(events);
      return { events: { ...s.events, [runId]: events }, runs: summary ? { ...s.runs, [runId]: summary } : s.runs };
    }),
  applyEvent: (e) => {
    if (get().boardId === null) return;
    set((s) => {
      const list = [...(s.events[e.runId] ?? []), e];
      const summary = summarizeRun(list);
      if (summary && summary.boardId !== s.boardId) return {};
      return { events: { ...s.events, [e.runId]: list }, runs: summary ? { ...s.runs, [e.runId]: summary } : s.runs };
    });
  },
  toast: (t) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    setTimeout(() => get().dismiss(id), t.kind === "fail" ? 8000 : 3200);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

/** Keep runs that started live (from SSE) but are not in a freshly loaded list yet. */
function liveOnly(current: Record<string, RunSummary>, list: RunSummary[]): Record<string, RunSummary> {
  const ids = new Set(list.map((r) => r.runId));
  return Object.fromEntries(Object.entries(current).filter(([id]) => !ids.has(id)));
}

/** Most recent run per agent node. */
export function latestRunByAgent(runs: Record<string, RunSummary>): Map<string, RunSummary> {
  const out = new Map<string, RunSummary>();
  for (const r of Object.values(runs)) {
    const prev = out.get(r.agentNodeId);
    if (!prev || r.startedAt > prev.startedAt) out.set(r.agentNodeId, r);
  }
  return out;
}

/** Tool nodes with a call in flight, and tool nodes whose last call errored. */
export function toolActivity(events: Record<string, RunEvent[]>, runs: Record<string, RunSummary>): { active: Set<string>; errored: Set<string> } {
  const active = new Set<string>();
  const errored = new Set<string>();
  for (const [runId, list] of Object.entries(events)) {
    const running = runs[runId]?.status === "running";
    const open = new Map<string, number>();
    for (const e of list) {
      if (e.type === "run.tool.started" && e.toolNodeId) open.set(e.toolNodeId, (open.get(e.toolNodeId) ?? 0) + 1);
      if (e.type === "run.tool.finished" && e.toolNodeId) {
        open.set(e.toolNodeId, Math.max(0, (open.get(e.toolNodeId) ?? 1) - 1));
        if (e.isError) errored.add(e.toolNodeId);
        else errored.delete(e.toolNodeId);
      }
    }
    if (running) for (const [id, n] of open) if (n > 0) active.add(id);
  }
  return { active, errored };
}
