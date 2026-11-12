import { lazy, Suspense, useEffect, useMemo } from "react";
import type { AgentNode } from "../contracts/graph";
import { compileBoard, refreshDrift } from "./actions";
import { GraphView } from "./graph/GraphView";
import { engine, subscribeRunEvents } from "./lib/engine";
import { Boundary } from "./shell/Boundary";
import { HermesSheet } from "./shell/HermesSheet";
import { ReportSheet } from "./shell/ReportSheet";
import { NewAgentSheet } from "./shell/NewAgentSheet";
import { ToolCatalog } from "./shell/ToolCatalog";
import { TeamsSheet } from "./shell/TeamsSheet";
import { ShareSheet } from "./shell/ShareSheet";
import { Palette, VIEWS } from "./shell/Palette";
import { Rail } from "./shell/Rail";
import { SetupAssistant } from "./setup/SetupAssistant";
import { BrandMark, TitleBar } from "./shell/TitleBar";
import { BoardProvider, useBoard } from "./state/board";
import { useSignals } from "./state/signals";
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

/** Monaco and xterm are big: the Code view loads on first use. */
const CodeView = lazy(() => import("./workbench/CodeView"));
function CodeTab() {
  return <Suspense fallback={<section className="main flush-left" />}><CodeView /></Suspense>;
}

const BrowserView = lazy(() => import("./workbench/BrowserView"));
function BrowserTab() {
  return <Suspense fallback={<section className="main flush-left" />}><BrowserView /></Suspense>;
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
      if (k === "k") {
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
      </Boundary>
      <Boundary>
        <TeamsSheet />
      </Boundary>
      <Boundary>
        <ShareSheet />
      </Boundary>
      <BoardEffects />
    </>
  );
}

function Offline({ down }: { down: boolean }) {
  return (
    <div className="offline" style={{ gridRow: "1 / span 2" }} data-tauri-drag-region>
      <div className="empty">
        <BrandMark size={44} />
        <h3>{down ? "McBot engine isn't running" : "Connecting…"}</h3>
        {down && <p>Start it with <code>npm run dev</code>.</p>}
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
