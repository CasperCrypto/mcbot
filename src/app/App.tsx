import { LoaderCircle } from "lucide-react";
import { FrameStrip } from "./shell/WindowControls";
import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType } from "react";
import type { AgentNode } from "../contracts/graph";
import { compileBoard, refreshDrift, runAgent } from "./actions";
import { DEMO, engine, REMOTE, subscribeHarness, subscribeRunEvents } from "./lib/engine";
import { openExternal } from "./lib/open";
import { Boundary } from "./shell/Boundary";
import { HermesSheet } from "./shell/HermesSheet";
import { ReportSheet } from "./shell/ReportSheet";
import { DoctorSheet } from "./shell/DoctorSheet";
import { NewAgentSheet } from "./shell/NewAgentSheet";
import { ToolCatalog } from "./shell/ToolCatalog";
import { ChatAppCatalog } from "./shell/ChatAppCatalog";
import { TeamPanel } from "./shell/TeamPanel";
import { TeamsSheet } from "./shell/TeamsSheet";
import { KnowledgeSheet } from "./shell/KnowledgeSheet";
import { BuilderSheet } from "./shell/BuilderSheet";
import { DrawingSheet } from "./chat/DrawingSheet";
import { ShareSheet } from "./shell/ShareSheet";
import { GitHubSheet, useGitHubDrops } from "./shell/GitHubSheet";
import { FolderPicker } from "./shell/FolderPicker";
import { Palette, VIEWS } from "./shell/Palette";
import { Rail } from "./shell/Rail";
import { SetupAssistant } from "./setup/SetupAssistant";
import { BrandMark, TitleBar } from "./shell/TitleBar";
import { BoardProvider, useBoard } from "./state/board";
import { useSignals } from "./state/signals";
import { engineRestart, engineStatus, inApp, onSummon, type EngineStatus } from "./lib/desktop";
import { stepScale } from "./lib/appearance";
import { engineDetails, engineVerdict } from "./lib/engineHealth";
import { useApp, viewOf } from "./state/store";
import { useTasks } from "./views/TasksView";
import { AgentsView } from "./views/AgentsView";
import { HomeView } from "./views/HomeView";
import { TasksView } from "./views/TasksView";

/** Shown while a view that loads on first use (Code, Browser) arrives. */
const Loading = () => <section className="main flush-left view-loading" aria-busy="true"><LoaderCircle size={20} className="spin-icon" /></section>;

/**
 * Views load on first use, so the window paints Chat without React Flow, Monaco or xterm. Right
 * after the first paint the light ones are fetched in the background (`prefetchViews`), so
 * switching to them later never shows the placeholder; Code (Monaco) waits until it is opened.
 */
function lazyView<M>(load: () => Promise<M>, pick: (m: M) => ComponentType, prefetch = true) {
  let promise: Promise<{ default: ComponentType }> | null = null;
  const get = () => (promise ??= load().then((m) => ({ default: pick(m) })));
  if (prefetch) PREFETCH.push(get);
  const View = lazy(get);
  return function LazyView() {
    return <Suspense fallback={<Loading />}><View /></Suspense>;
  };
}
const PREFETCH: (() => Promise<unknown>)[] = [];
let prefetched = false;
/** Fetch the views not on screen yet, one after another, while the window is idle. */
function prefetchViews() {
  if (prefetched) return;
  prefetched = true;
  const idle = (f: () => void) => ("requestIdleCallback" in window ? window.requestIdleCallback(f, { timeout: 2000 }) : setTimeout(f, 300));
  const next = (i: number) => {
    if (i < PREFETCH.length) idle(() => void PREFETCH[i]!().catch(() => undefined).finally(() => next(i + 1)));
  };
  next(0);
}

const GraphView = lazyView(() => import("./graph/GraphView"), (m) => m.GraphView);
const RunsView = lazyView(() => import("./views/RunsView"), (m) => m.RunsView);
const KnowledgeView = lazyView(() => import("./views/KnowledgeView"), (m) => m.KnowledgeView);
const FilesView = lazyView(() => import("./views/FilesView"), (m) => m.FilesView);
const CostView = lazyView(() => import("./views/CostView"), (m) => m.CostView);
const TeamView = lazyView(() => import("./views/TeamView"), (m) => m.TeamView);
const SettingsView = lazyView(() => import("./views/SettingsView"), (m) => m.SettingsView);
const BrowserTab = lazyView(() => import("./workbench/BrowserView"), (m) => m.default);
const PasswordsView = lazyView(() => import("./views/PasswordsView"), (m) => m.PasswordsView);

const VIEW_COMPONENTS = {
  home: HomeView,
  graph: GraphView,
  agents: AgentsView,
  tasks: TasksView,
  // Code is part of Files now (old links and pins land there).
  code: FilesView,
  browser: BrowserTab,
  workflows: RunsView,
  knowledge: KnowledgeView,
  memory: KnowledgeView,
  skills: KnowledgeView,
  files: FilesView,
  passwords: PasswordsView,
  cost: CostView,
  learn: KnowledgeView,
  team: TeamView,
  settings: SettingsView,
} as const;

function BoardEffects() {
  const { boardId, graph } = useBoard();
  const loadRuns = useApp((s) => s.loadRuns);
  const runs = useApp((s) => s.runs);
  const drift = useApp((s) => s.drift);
  const { tasks } = useTasks(boardId, 5000);
  const agents = useMemo(() => graph.nodes.filter((n): n is AgentNode => n.kind === "agent"), [graph]);
  useSignals(tasks, runs, drift, agents);

  useEffect(() => {
    engine.runs(boardId).then(loadRuns).catch(() => undefined);
    // Thumbs on answers, for Chat and Learn (a guest's window has none to read).
    if (REMOTE?.role !== "chat") engine.ratings(boardId).then((r) => useApp.getState().setRatings(r)).catch(() => undefined);
  }, [boardId, loadRuns]);

  // The queue: an agent that is free takes its next queued message. One at a time per agent
  // (`starting` covers a run that was asked for but has not reported yet); a message that cannot
  // start goes back first and the queue waits (the chat says so).
  const queue = useApp((s) => s.queue);
  const starting = useApp((s) => s.starting);
  useEffect(() => {
    const app = useApp.getState();
    for (const [agentId, q] of Object.entries(queue)) {
      if (q.paused || q.items.length === 0 || starting[agentId]) continue;
      if (Object.values(runs).some((r) => r.agentNodeId === agentId && r.status === "running")) continue;
      const text = app.takeQueued(agentId);
      if (!text) continue;
      void runAgent(boardId, agentId, text).then((id) => {
        if (!id) useApp.getState().pauseQueue(agentId, text);
      });
    }
  }, [queue, runs, boardId, starting]);

  // How many files on disk differ from the board right now (debounced dry-run compile).
  useEffect(() => {
    const t = setTimeout(() => void refreshDrift(boardId), 500);
    return () => clearTimeout(t);
  }, [boardId, graph]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const app = useApp.getState();
      const k = e.key.toLowerCase();
      if (k === ",") {
        e.preventDefault();
        app.openSettings();
      } else if (k === "k") {
        e.preventDefault();
        app.setPalette(!app.paletteOpen);
      } else if (k === "s" && !(viewOf(app.tab) === "files" && document.querySelector("[data-saves='true']"))) {
        // In Files, with a file open, ⌘S saves the file (views/FilesView.tsx).
        e.preventDefault();
        void compileBoard(boardId);
      } else if (/^[1-9]$/.test(k) && VIEWS[Number(k) - 1]) {
        e.preventDefault();
        app.setTab(VIEWS[Number(k) - 1]!.tab);
      } else if ((k === "=" || k === "+" || k === "-") && inApp()) {
        // Bigger or smaller, the whole app (a web browser zooms by itself).
        e.preventDefault();
        app.setAppearance({ ...app.appearance, scale: stepScale(app.appearance.scale, k === "-" ? -1 : 1) });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [boardId]);

  // A newer McBot is out: say so once per launch, a little after the window settles.
  useEffect(() => {
    if (REMOTE || DEMO) return;
    const t = setTimeout(() => {
      engine.update().then((u) => {
        if (u.available && u.url) useApp.getState().toast({ kind: "ok", text: `McBot Studio ${u.latest} is out`, action: { label: "Download", run: () => void openExternal(u.url!) } });
      }).catch(() => undefined);
    }, 4000);
    return () => clearTimeout(t);
  }, []);

  // The launcher shortcut from anywhere: this window comes forward with ⌘K open.
  useEffect(() => {
    let off: (() => void) | null = null;
    let live = true;
    void onSummon(() => useApp.getState().setPalette(true)).then((f) => { if (live) off = f; else f(); });
    return () => { live = false; off?.(); };
  }, []);
  return null;
}

function Shell() {
  const tab = useApp((s) => s.tab);
  const View = VIEW_COMPONENTS[tab];
  useEffect(() => {
    prefetchViews();
  }, []);
  // A GitHub link pasted or dropped anywhere opens Add from GitHub with it.
  useGitHubDrops();
  return (
    <>
      <TitleBar />
      <div className="app-body">
        <Rail />
        <div className="frame" key={viewOf(tab)} data-tab={tab}>
          <Boundary resetKey={tab}>
            <View />
          </Boundary>
        </div>
      </div>
      <Boundary>
        <Palette />
      </Boundary>
      <Boundary>
        <HermesSheet />
      </Boundary>
      <Boundary>
        <ReportSheet />
        <DoctorSheet />
      </Boundary>
      <Boundary>
        <NewAgentSheet />
      </Boundary>
      <Boundary>
        <ToolCatalog />
        <ChatAppCatalog />
        <TeamPanel />
      </Boundary>
      <Boundary>
        <TeamsSheet />
        <KnowledgeSheet />
        <BuilderSheet />
        <DrawingSheet />
      </Boundary>
      <Boundary>
        <ShareSheet />
        <GitHubSheet />
        <FolderPicker />
      </Boundary>
      <BoardEffects />
    </>
  );
}

/** When the page opened: the installed app's engine needs a few seconds to start after the window. */
const OPENED = Date.now();

function Offline({ down }: { down: boolean }) {
  // The window opens before the engine answers: that is "starting", not a problem, for a while.
  // In the app the shell says how its engine is doing, so a stopped or blocked engine is named at
  // once, with its log's end, Copy and Restart (lib/engineHealth.ts).
  const [now, setNow] = useState(Date.now());
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [restarting, setRestarting] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!down || !inApp()) return;
    let alive = true;
    const ask = () => void engineStatus().then((st) => { if (alive) setStatus(st); });
    ask();
    const t = setInterval(ask, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [down]);
  const verdict = down ? engineVerdict(status, now - OPENED) : { kind: "starting" as const };
  const restart = async () => {
    setRestarting(true);
    setStatus(await engineRestart());
    setRestarting(false);
  };
  const [copied, setCopied] = useState(false);
  const copy = () => void navigator.clipboard?.writeText(engineDetails(verdict, status)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => undefined);
  return (
    <div className="offline" style={{ gridRow: "1 / span 2" }} data-tauri-drag-region>
      <FrameStrip />
      <div className="empty" data-testid="offline">
        <BrandMark size={44} />
        <h3>{verdict.kind === "starting" ? "Starting McBot Studio…" : verdict.title}</h3>
        {(verdict.kind === "starting" || verdict.kind === "slow") && <LoaderCircle size={18} className="spin-icon faint" />}
        {verdict.kind !== "starting" && <p>{verdict.hint}</p>}
        {verdict.kind !== "starting" && verdict.kind !== "dev" && (
          <>
            {status?.log && <pre className="engine-log" data-testid="engine-log">{status.log}</pre>}
            <div className="row" style={{ justifyContent: "center" }}>
              <button className="btn light" disabled={restarting} onClick={() => void restart()} data-testid="engine-restart">{restarting ? "Restarting…" : "Restart engine"}</button>
              <button className="btn" onClick={copy} data-tip={status?.logPath ?? undefined} data-testid="engine-copy">{copied ? "Copied" : "Copy details"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function App() {
  const setHealth = useApp((s) => s.setHealth);
  const setBoards = useApp((s) => s.setBoards);
  const setBoard = useApp((s) => s.setBoard);
  const applyEvent = useApp((s) => s.applyEvent);
  const engineUp = useApp((s) => s.engineUp);
  const boards = useApp((s) => s.boards);
  const boardId = useApp((s) => s.boardId);
  const setup = useApp((s) => s.setup);
  const setSetup = useApp((s) => s.setSetup);

  // First launch runs the setup assistant. An engine without /api/setup is treated as set up.
  useEffect(() => {
    if (engineUp && !setup) engine.setup().then(setSetup).catch(() => setSetup({ completed: true, profile: null }));
  }, [engineUp, setup, setSetup]);

  const finishSetup = async (newBoardId: string | null, agentNodeId: string | null) => {
    const app = useApp.getState();
    app.setSetup(await engine.setup().catch(() => ({ completed: true, profile: null })));
    app.setBoards(await engine.boards().catch(() => app.boards));
    if (newBoardId) {
      app.setBoard(newBoardId);
      if (agentNodeId) app.openChat(agentNodeId);
      else app.setTab("graph");
    }
  };

  // Every 5 s once the engine answers; every 400 ms while it starts (the window opens first), so
  // "Starting McBot Studio…" goes away the moment the engine is up, not up to 5 s later.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let up = false;
      try {
        const h = await engine.health();
        if (!alive) return;
        setHealth(h, true);
        up = true;
        const list = await engine.boards();
        setBoards(list);
        const current = useApp.getState().boardId;
        if (!current || !list.some((b) => b.id === current)) setBoard(list[0]?.id ?? null);
      } catch {
        if (alive && !up) setHealth(null, false);
      }
      if (alive) timer = setTimeout(poll, up ? 5000 : 400);
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [setHealth, setBoards, setBoard]);

  useEffect(() => subscribeRunEvents(applyEvent), [applyEvent]);
  // Changes made in Hermes (the CLI, an agent, another editor) reach the board by themselves; say so.
  useEffect(() => subscribeHarness((c) => {
    const app = useApp.getState();
    if (c.boardId === app.boardId) app.toast({ kind: "ok", text: `${c.agent} changed in Hermes: ${c.changed.join(", ")}` });
  }), []);

  const ready = engineUp && boards.length > 0 && boardId && setup;
  if (ready && !setup.completed) {
    return (
      <Boundary>
        <SetupAssistant onDone={(b, a) => void finishSetup(b, a)} />
      </Boundary>
    );
  }
  return (
    <div className="app">
      {ready ? (
        <BoardProvider fallback={<Offline down={false} />}>
          <Shell />
        </BoardProvider>
      ) : (
        <Offline down={engineUp === false} />
      )}
    </div>
  );
}
