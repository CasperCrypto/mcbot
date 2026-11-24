import { create } from "zustand";
import type { Scene } from "../chat/drawing";
import type { BoardInfo, CompileResponse, Health, SetupState } from "../../contracts/api";
import { summarizeRun, type RunEvent, type RunSummary } from "../../contracts/run";
import { loadIdentity, saveIdentity, type Identity } from "../lib/identity";
import { applyAppearance, loadAppearance, saveAppearance, type Appearance } from "../lib/appearance";

export type Tab = "home" | "graph" | "agents" | "tasks" | "code" | "browser" | "workflows" | "memory" | "skills" | "files" | "passwords" | "cost" | "team" | "settings";

export type SettingsSection = "models" | "keys" | "appearance" | "you" | "team" | "engine" | "about";

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
  /** The accent colour (Settings → Appearance; kept per computer). McBot is dark, always. */
  appearance: Appearance;
  selectedNodeId: string | null;
  selectedRunId: string | null;
  compileOpen: boolean;
  compileBusy: boolean;
  compile: CompileResponse | null;
  /** Files the board would change if compiled now (null = unknown). */
  drift: number | null;
  /** Each compiled agent's files on disk, from the last dry-run compile: "fresh" = same as the board,
   *  "stale" = the board changed since; an agent missing here has no files yet (null = unknown). */
  onDisk: Record<string, "fresh" | "stale"> | null;
  events: Record<string, RunEvent[]>;
  runs: Record<string, RunSummary>;
  toasts: Toast[];
  /** The last notices, newest first, kept after they leave the island's bar (it lists them when open). */
  notices: (Toast & { at: number })[];
  clearNotices(): void;
  paletteOpen: boolean;
  /** The Hermes runtime sheet. */
  hermesOpen: boolean;
  /** Report a problem. */
  reportOpen: boolean;
  /** Harness doctor (shell/DoctorSheet.tsx). */
  doctorOpen: boolean;
  /** The New agent sheet. */
  newAgentOpen: boolean;
  /** The tool catalog. */
  catalogOpen: boolean;
  /** The board's History panel (graph/HistoryPanel.tsx): versions of the harness and their runs. */
  historyOpen: boolean;
  /** The agent the tool or chat-app catalog adds to, when opened from that agent's page. */
  catalogFor: string | null;
  /** The Chat view shows the agent's page beside the conversation. */
  agentInfo: boolean;
  /** The board's live files panel (what Compile would write). */
  liveFilesOpen: boolean;
  chatAppsOpen: boolean;
  /** Starter teams. */
  teamsOpen: boolean;
  /** Ask McBot (shell/BuilderSheet.tsx), with the words it opened with. */
  builder: { open: boolean; request: string };
  /** The drawing open full size (chat/DrawingSheet.tsx): a scene, and where it saves when it came from a file. */
  drawing: { scene: Scene; title: string; file?: { root: string; path: string; sha256: string | null } } | null;
  /** Bumped to ask the board to fit everything in view (after a team or a plan joins it). */
  fitRequest: number;
  /** Share on your network / join. */
  shareOpen: boolean;
  teamOpen: boolean;
  /** Messages typed while an agent was busy, sent in order when it is free (per agent node). */
  queue: Record<string, { items: string[]; paused: boolean }>;
  /** Agents with a run being started right now (its first event has not arrived yet). */
  starting: Record<string, boolean>;
  /** Which part of Settings is open. */
  settingsSection: SettingsSection;
  /** The folder picker (Files, Code, ⌘K Open folder). */
  folderPickerOpen: boolean;
  /** The folder the picker opened last: Files and Code reload their folders and show it. */
  openedFolder: { id: string; at: number } | null;
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
  setDoctorOpen(open: boolean): void;
  setNewAgentOpen(open: boolean): void;
  setCatalogOpen(open: boolean): void;
  setLiveFilesOpen(open: boolean): void;
  setChatAppsOpen(open: boolean): void;
  /** Add a tool or a chat app to one agent (from its page): the catalog wires it there. */
  addTo(kind: "tool" | "app", agentNodeId: string): void;
  setAgentInfo(open: boolean): void;
  setHistoryOpen(open: boolean): void;
  /** Open an agent's page (its chat, with the page beside it): from Home, ⌘K, New agent. */
  editAgent(agentNodeId: string): void;
  setTeamsOpen(open: boolean): void;
  setBuilder(open: boolean, request?: string): void;
  openDrawing(drawing: State["drawing"]): void;
  requestFit(): void;
  setShareOpen(open: boolean): void;
  setTeamOpen(open: boolean): void;
  setFolderPickerOpen(open: boolean): void;
  openSettings(section?: SettingsSection): void;
  enqueue(agentNodeId: string, text: string): void;
  /** Take the next queued message (null when empty or paused). */
  takeQueued(agentNodeId: string): string | null;
  unqueue(agentNodeId: string, index: number): void;
  /** A queued message could not start: put it back first and wait for the person. */
  pauseQueue(agentNodeId: string, text: string): void;
  resumeQueue(agentNodeId: string): void;
  setStarting(agentNodeId: string, on: boolean): void;
  folderOpened(id: string): void;
  setFreshNote(id: string | null): void;
  openChat(agentNodeId: string | null): void;
  showTask(id: string | null, tab?: boolean): void;
  setSetup(setup: SetupState | null): void;
  setBoard(id: string | null): void;
  setBoards(b: BoardInfo[]): void;
  setHealth(h: Health | null, up: boolean): void;
  setIdentity(id: Identity): void;
  setAppearance(a: Appearance): void;
  /** Show the stored appearance again (another window changed it). */
  syncAppearance(a?: Appearance): void;
  select(nodeId: string | null): void;
  selectRun(runId: string | null): void;
  setCompile(patch: Partial<Pick<State, "compileOpen" | "compileBusy" | "compile" | "drift" | "onDisk">>): void;
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
  tab: "agents",
  boardId: savedBoard(),
  boards: [],
  health: null,
  engineUp: null,
  identity: loadIdentity(),
  appearance: loadAppearance(),
  selectedNodeId: null,
  selectedRunId: null,
  compileOpen: false,
  compileBusy: false,
  compile: null,
  drift: null,
  onDisk: null,
  events: {},
  runs: {},
  toasts: [],
  notices: [],
  paletteOpen: false,
  chatAgentId: null,

  setTab: (tab) => set({ tab }),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  hermesOpen: false,
  setHermesOpen: (hermesOpen) => set({ hermesOpen, paletteOpen: false }),
  reportOpen: false,
  doctorOpen: false,
  setReportOpen: (reportOpen) => set({ reportOpen, paletteOpen: false }),
  setDoctorOpen: (doctorOpen) => set({ doctorOpen, paletteOpen: false }),
  newAgentOpen: false,
  setNewAgentOpen: (newAgentOpen) => set({ newAgentOpen, paletteOpen: false }),
  catalogOpen: false,
  catalogFor: null,
  historyOpen: false,
  agentInfo: (() => { try { return localStorage.getItem("mcbot.agentInfo") === "1"; } catch { return false; } })(),
  liveFilesOpen: (() => { try { return localStorage.getItem("mcbot.liveFiles") === "1"; } catch { return false; } })(),
  chatAppsOpen: false,
  teamsOpen: false,
  builder: { open: false, request: "" },
  drawing: null,
  fitRequest: 0,
  shareOpen: false,
  teamOpen: false,
  setShareOpen: (shareOpen) => set({ shareOpen, paletteOpen: false }),
  // One panel on the right at a time: team chat and the board's inspector never stack their glass.
  setTeamOpen: (teamOpen) => set((s) => ({ teamOpen, paletteOpen: false, selectedNodeId: teamOpen && s.tab === "graph" ? null : s.selectedNodeId })),
  queue: {},
  starting: {},
  setStarting: (id, on) => set((s) => ({ starting: { ...s.starting, [id]: on } })),
  enqueue: (id, text) => set((s) => ({ queue: { ...s.queue, [id]: { items: [...(s.queue[id]?.items ?? []), text], paused: s.queue[id]?.paused ?? false } } })),
  takeQueued: (id) => {
    const q = get().queue[id];
    if (!q || q.paused || q.items.length === 0) return null;
    const [first, ...rest] = q.items;
    set((s) => ({ queue: { ...s.queue, [id]: { items: rest, paused: false } } }));
    return first!;
  },
  unqueue: (id, index) => set((s) => {
    const q = s.queue[id];
    if (!q) return {};
    const items = q.items.filter((_, i) => i !== index);
    return { queue: { ...s.queue, [id]: { items, paused: items.length ? q.paused : false } } };
  }),
  pauseQueue: (id, text) => set((s) => ({ queue: { ...s.queue, [id]: { items: [text, ...(s.queue[id]?.items ?? [])], paused: true } } })),
  resumeQueue: (id) => set((s) => (s.queue[id] ? { queue: { ...s.queue, [id]: { ...s.queue[id]!, paused: false } } } : {})),
  settingsSection: "models",
  openSettings: (section) => set((s) => ({ tab: "settings", settingsSection: section ?? s.settingsSection, paletteOpen: false })),
  folderPickerOpen: false,
  openedFolder: null,
  setFolderPickerOpen: (folderPickerOpen) => set({ folderPickerOpen, paletteOpen: false }),
  folderOpened: (id) => set({ openedFolder: { id, at: Date.now() }, folderPickerOpen: false }),
  setTeamsOpen: (teamsOpen) => set({ teamsOpen, paletteOpen: false, newAgentOpen: false }),
  requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),
  openDrawing: (drawing) => set({ drawing, paletteOpen: false }),
  setBuilder: (open, request = "") => set((s) => ({ builder: { open, request: open ? request : s.builder.request }, paletteOpen: false, newAgentOpen: false, teamsOpen: false })),
  freshNote: null,
  setFreshNote: (freshNote) => set({ freshNote }),
  setCatalogOpen: (catalogOpen) => set({ catalogOpen, paletteOpen: false, ...(catalogOpen ? {} : { catalogFor: null }) }),
  setLiveFilesOpen: (liveFilesOpen) => {
    try { localStorage.setItem("mcbot.liveFiles", liveFilesOpen ? "1" : "0"); } catch { /* private window */ }
    set({ liveFilesOpen, paletteOpen: false, ...(liveFilesOpen ? { historyOpen: false } : {}) });
  },
  // History and the live files share the board's left side: one at a time.
  setHistoryOpen: (historyOpen) => set({ historyOpen, paletteOpen: false, ...(historyOpen ? { liveFilesOpen: false } : {}) }),
  setChatAppsOpen: (chatAppsOpen) => set({ chatAppsOpen, paletteOpen: false, ...(chatAppsOpen ? {} : { catalogFor: null }) }),
  addTo: (kind, catalogFor) => set({ catalogFor, catalogOpen: kind === "tool", chatAppsOpen: kind === "app", paletteOpen: false }),
  setAgentInfo: (agentInfo) => {
    try { localStorage.setItem("mcbot.agentInfo", agentInfo ? "1" : "0"); } catch { /* private window */ }
    set({ agentInfo });
  },
  editAgent: (chatAgentId) => {
    try { localStorage.setItem("mcbot.agentInfo", "1"); } catch { /* private window */ }
    set({ chatAgentId, tab: "agents", agentInfo: true, paletteOpen: false });
  },
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
    set({ boardId, selectedNodeId: null, selectedRunId: null, chatAgentId: null, openTask: null, compile: null, compileOpen: false, drift: null, onDisk: null, events: {}, runs: {} });
  },
  setBoards: (boards) => set({ boards }),
  setHealth: (health, engineUp) => set({ health, engineUp }),
  setAppearance: (appearance) => {
    saveAppearance(appearance);
    applyAppearance(appearance);
    set({ appearance });
  },
  syncAppearance: (a) => {
    const appearance = a ?? get().appearance;
    applyAppearance(appearance);
    set({ appearance });
  },
  setIdentity: (identity) => {
    saveIdentity(identity);
    set({ identity });
  },
  select: (selectedNodeId) => set((s) => ({ selectedNodeId, teamOpen: selectedNodeId && s.tab === "graph" ? false : s.teamOpen })),
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
  clearNotices: () => set({ notices: [] }),
  toast: (t) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { ...t, id }], notices: [{ ...t, id, at: Date.now() }, ...s.notices].slice(0, 8) }));
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
