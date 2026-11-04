import { Bot, Brain, ChevronDown, CircleDollarSign, FolderOpen, Hammer, LoaderCircle, Plus, Users, Waypoints, Workflow } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { resolveGraph } from "../compile";
import { compileBoard, refreshDrift } from "./actions";
import { GraphTab } from "./graph/GraphTab";
import { engine, subscribeRunEvents } from "./lib/engine";
import { initials } from "./lib/identity";
import { BoardProvider, useBoard } from "./state/board";
import { useApp, type Tab } from "./state/store";
import { AgentsTab } from "./tabs/AgentsTab";
import { CostTab } from "./tabs/CostTab";
import { FilesTab } from "./tabs/FilesTab";
import { MemoryTab } from "./tabs/MemoryTab";
import { TeamTab } from "./tabs/TeamTab";
import { WorkflowsTab } from "./tabs/WorkflowsTab";
import { Empty, Toasts } from "./ui";

const NAV: { section: string; items: { tab: Tab; label: string; icon: ReactNode }[] }[] = [
  { section: "Harness", items: [
    { tab: "graph", label: "Graph", icon: <Waypoints size={16} /> },
    { tab: "agents", label: "Agents", icon: <Bot size={16} /> },
    { tab: "workflows", label: "Workflows", icon: <Workflow size={16} /> },
  ] },
  { section: "Knowledge", items: [
    { tab: "memory", label: "Memory", icon: <Brain size={16} /> },
    { tab: "files", label: "Files", icon: <FolderOpen size={16} /> },
  ] },
  { section: "Operations", items: [
    { tab: "cost", label: "Cost", icon: <CircleDollarSign size={16} /> },
    { tab: "team", label: "Team", icon: <Users size={16} /> },
  ] },
];

const TITLES: Record<Tab, [string, string]> = {
  graph: ["Graph", "Draw it, wire it, compile it"],
  agents: ["Agents", "Every agent on this board"],
  workflows: ["Workflows", "Runs, step by step"],
  memory: ["Memory", "What each agent knows"],
  files: ["Files", "Each agent's Hermes profile on disk"],
  cost: ["Cost", "Spend by agent, model and day"],
  team: ["Team", "Who is on this board"],
};

function BoardSwitcher() {
  const boards = useApp((s) => s.boards);
  const boardId = useApp((s) => s.boardId);
  const setBoard = useApp((s) => s.setBoard);
  const setBoards = useApp((s) => s.setBoards);
  const toast = useApp((s) => s.toast);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const current = boards.find((b) => b.id === boardId);

  const create = async () => {
    setOpen(false);
    const name = window.prompt("Name the new board", "Untitled harness");
    if (!name?.trim()) return;
    try {
      const b = await engine.createBoard(name.trim());
      setBoards(await engine.boards());
      setBoard(b.id);
    } catch (err) {
      toast({ kind: "fail", text: (err as Error).message });
    }
  };

  const r = btn.current?.getBoundingClientRect();
  return (
    <>
      <button ref={btn} className="board-switch" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        <span className="label">{current?.name ?? "Choose a board"}</span>
        <ChevronDown size={14} className="faint" />
      </button>
      {open && (
        <>
          <div className="scrim" onClick={() => setOpen(false)} />
          <div className="menu" role="menu" style={{ top: (r?.bottom ?? 0) + 4, left: r?.left ?? 0, width: r?.width }}>
            {boards.map((b) => <button key={b.id} role="menuitem" onClick={() => { setBoard(b.id); setOpen(false); }}>{b.name || b.id}</button>)}
            <hr />
            <button role="menuitem" onClick={create}><Plus size={14} /> New board…</button>
          </div>
        </>
      )}
    </>
  );
}

function Sidebar() {
  const tab = useApp((s) => s.tab);
  const setTab = useApp((s) => s.setTab);
  const health = useApp((s) => s.health);
  const engineUp = useApp((s) => s.engineUp);
  const runs = useApp((s) => s.runs);
  const live = Object.values(runs).filter((r) => r.status === "running").length;
  return (
    <nav className="sidebar" aria-label="Main">
      <div className="brand">
        <div className="brand-mark"><Bot size={14} strokeWidth={2.4} /></div>
        <span className="brand-name">McBot</span>
        <span className="brand-sub">for Hermes</span>
      </div>
      <BoardSwitcher />
      {NAV.map((g) => (
        <div key={g.section}>
          <div className="nav-section">{g.section}</div>
          {g.items.map((i) => (
            <button key={i.tab} className="nav-item" aria-current={tab === i.tab ? "page" : undefined} onClick={() => setTab(i.tab)} data-testid={`tab-${i.tab}`}>
              {i.icon}<span>{i.label}</span>
              {i.tab === "workflows" && live > 0 && <span className="count live">{live}</span>}
            </button>
          ))}
        </div>
      ))}
      <div className="sidebar-foot">
        <div className="engine-line"><span className={`dot ${engineUp ? "ok" : engineUp === false ? "fail" : ""}`} />{engineUp ? "Engine running" : engineUp === false ? "Engine offline" : "Connecting…"}</div>
        <div className="engine-line"><span className={`dot ${health?.hermes.found ? "ok" : "warn"}`} />{health ? (health.hermes.found ? "Hermes found" : "Hermes not found") : "Hermes —"}</div>
        {health && <div className="engine-line" title={`HERMES_HOME for compiled agents:\n${health.hermesHome}`}><span className="path mono">…/{health.hermesHome.split(/[\\/]/).filter(Boolean).slice(-2).join("/")}</span></div>}
      </div>
    </nav>
  );
}

function Toolbar() {
  const tab = useApp((s) => s.tab);
  const busy = useApp((s) => s.compileBusy);
  const drift = useApp((s) => s.drift);
  const compileOpen = useApp((s) => s.compileOpen);
  const setCompile = useApp((s) => s.setCompile);
  const identity = useApp((s) => s.identity);
  const { boardId, peers, graph, synced } = useBoard();
  const errors = useMemo(() => (graph.nodes.length ? resolveGraph(graph).issues.filter((i) => i.level === "error").length : 0), [graph]);
  const [title, sub] = TITLES[tab];

  return (
    <header className="toolbar">
      <h1>{title}</h1>
      <span className="sub">{sub}</span>
      <div className="spacer" />
      {!synced && <span className="badge"><LoaderCircle size={11} className="spin" /> connecting</span>}
      <div className="avatars" aria-label="People on this board" data-testid="presence">
        {[{ name: identity.name, color: identity.color, clientId: -1 }, ...peers].slice(0, 6).map((p) => (
          <div key={p.clientId} className="avatar" title={p.clientId === -1 ? `${p.name} (you)` : p.name} style={{ background: p.color }}>{initials(p.name)}</div>
        ))}
      </div>
      {tab === "graph" && graph.nodes.length > 0 && (
        <button className="btn ghost" onClick={() => setCompile({ compileOpen: !compileOpen })} disabled={!useApp.getState().compile}>Output</button>
      )}
      <button className="btn primary" onClick={() => void compileBoard(boardId)} disabled={busy || graph.nodes.length === 0} data-testid="compile" title={errors ? `${errors} error(s) on the board` : "Write the Hermes profiles (⌘S)"}>
        {busy ? <LoaderCircle size={13} /> : <Hammer size={13} />} Compile
        {errors > 0 ? <span className="badge fail" style={{ marginLeft: 2 }}>{errors}</span> : drift ? <span className="badge" style={{ marginLeft: 2, background: "rgba(255,255,255,.25)", color: "inherit" }}>{drift}</span> : null}
      </button>
    </header>
  );
}

function BoardEffects() {
  const { boardId, graph } = useBoard();
  const loadRuns = useApp((s) => s.loadRuns);

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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void compileBoard(boardId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [boardId]);
  return null;
}

function Content() {
  const tab = useApp((s) => s.tab);
  return (
    <div className="content">
      {tab === "graph" && <GraphTab />}
      {tab === "agents" && <AgentsTab />}
      {tab === "workflows" && <WorkflowsTab />}
      {tab === "memory" && <MemoryTab />}
      {tab === "files" && <FilesTab />}
      {tab === "cost" && <CostTab />}
      {tab === "team" && <TeamTab />}
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

  const offline = (
    <div className="main">
      <div className="toolbar"><h1>McBot</h1></div>
      <Empty title={engineUp === false ? "The McBot engine is not running" : "Connecting to the engine…"}>
        {engineUp === false ? <>Start it with <code>npm run engine</code> (or <code>npm run dev</code>). It holds the shared board and runs Hermes for you.</> : null}
      </Empty>
    </div>
  );

  return (
    <div className="shell">
      <Sidebar />
      {engineUp && boards.length > 0 && boardId ? (
        <BoardProvider fallback={offline}>
          <div className="main">
            <BoardEffects />
            <Toolbar />
            <Content />
          </div>
        </BoardProvider>
      ) : offline}
      <Toasts />
    </div>
  );
}
