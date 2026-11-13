import { LoaderCircle } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { AgentNode } from "../contracts/graph";
import { compileBoard, refreshDrift, runAgent } from "./actions";
import { GraphView } from "./graph/GraphView";
import { engine, subscribeHarness, subscribeRunEvents } from "./lib/engine";
import { Boundary } from "./shell/Boundary";
import { HermesSheet } from "./shell/HermesSheet";
import { ReportSheet } from "./shell/ReportSheet";
import { NewAgentSheet } from "./shell/NewAgentSheet";
import { ToolCatalog } from "./shell/ToolCatalog";
import { ChatAppCatalog } from "./shell/ChatAppCatalog";
import { TeamPanel } from "./shell/TeamPanel";
import { TeamsSheet } from "./shell/TeamsSheet";
import { ShareSheet } from "./shell/ShareSheet";
import { FolderPicker } from "./shell/FolderPicker";
import { Palette, VIEWS } from "./shell/Palette";
import { Rail } from "./shell/Rail";
import { SetupAssistant } from "./setup/SetupAssistant";
import { BrandMark, TitleBar } from "./shell/TitleBar";
import { BoardProvider, useBoard } from "./state/board";
import { useSignals } from "./state/signals";
import { inApp } from "./lib/desktop";
import { useApp } from "./state/store";
import { useTasks } from "./views/TasksView";
import { AgentsView } from "./views/AgentsView";
import { CostView } from "./views/CostView";
import { FilesView } from "./views/FilesView";
import { HomeView } from "./views/HomeView";
import { MemoryView } from "./views/MemoryView";
import { RunsView } from "./views/RunsView";
import { TasksView } from "./views/TasksView";
import { TeamView } from "./views/TeamView";
import { SettingsView } from "./views/SettingsView";

/** Shown while a view that loads on first use (Code, Browser) arrives. */
const Loading = () => <section className="main flush-left view-loading" aria-busy="true"><LoaderCircle size={20} className="spin-icon" /></section>;

/** Monaco and xterm are big: the Code view loads on first use. */
const CodeView = lazy(() => import("./workbench/CodeView"));
function CodeTab() {
  return <Suspense fallback={<Loading />}><CodeView /></Suspense>;
}

const BrowserView = lazy(() => import("./workbench/BrowserView"));
function BrowserTab() {
  return <Suspense fallback={<Loading />}><BrowserView /></Suspense>;
}

const VIEW_COMPONENTS = {
  home: HomeView,
  graph: GraphView,
  agents: AgentsView,
  tasks: TasksView,
  code: CodeTab,
  browser: BrowserTab,
  workflows: RunsView,
  memory: MemoryView,
  files: FilesView,
  cost: CostView,
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
      } else if (k === "s" && app.tab !== "code") {
        // In Code, ⌘S saves the file (workbench/CodeView.tsx).
        e.preventDefault();
        void compileBoard(boardId);
      } else if (/^[1-9]$/.test(k) && VIEWS[Number(k) - 1]) {
        e.preventDefault();
        app.setTab(VIEWS[Number(k) - 1]!.tab);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [boardId]);
  return null;
}

function Shell() {
  const tab = useApp((s) => s.tab);
  const View = VIEW_COMPONENTS[tab];
  return (
    <>
      <TitleBar />
      <div className="app-body">
        <Rail />
        <div className="frame" key={tab} data-tab={tab}>
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
      </Boundary>
      <Boundary>
        <ShareSheet />
        <FolderPicker />
      </Boundary>
      <BoardEffects />
    </>
  );
}

/** When the page opened: the installed app's engine needs a few seconds to start after the window. */
const OPENED = Date.now();
/** How long a starting engine may stay silent before McBot says something is wrong. */
const PATIENCE_MS = 20_000;

function Offline({ down }: { down: boolean }) {
  // The window opens before the engine answers: that is "starting", not a problem, for a while.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const stuck = down && now - OPENED > PATIENCE_MS;
  return (
    <div className="offline" style={{ gridRow: "1 / span 2" }} data-tauri-drag-region>
      <div className="empty" data-testid="offline">
        <BrandMark size={44} />
        <h3>{stuck ? "McBot's engine didn't start" : "Starting McBot…"}</h3>
        {!stuck && <LoaderCircle size={18} className="spin-icon faint" />}
        {stuck && (inApp() ? <p>Quit McBot and open it again. If it keeps happening, the engine log is in McBot's data folder (engine.log).</p>
          : <p>Start it with <code>npm run dev</code>.</p>)}
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

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const h = await engine.health();
        if (!alive) return;
        setHealth(h, true);
        const list = await engine.boards();
        setBoards(list);
        const current = useApp.getState().boardId;
        if (!current || !list.some((b) => b.id === current)) setBoard(list[0]?.id ?? null);
      } catch {
        if (alive) setHealth(null, false);
      }
    };
    void poll();
    const t = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(t);
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
