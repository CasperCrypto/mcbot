import { Check, ChevronDown, Download, FolderOpen, Hammer, MessagesSquare, LoaderCircle, Plus, Search, Upload, Users } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { resolveGraph } from "../../compile";
import { compileBoard, exportBoardFile, importBoardFile, openHermesSetup } from "../actions";
import { DEMO, REMOTE } from "../lib/engine";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { Logo } from "../faces/FoodFace";
import { Kbd, PersonFace } from "../ui";
import { Island } from "./Island";
import { unreadCount } from "./TeamPanel";

/** The McBot logo: the gray glass burger. */
export function BrandMark({ size = 22 }: { size?: number }) {
  return <Logo size={size} />;
}

function BoardMenu() {
  const boards = useApp((s) => s.boards);
  const boardId = useApp((s) => s.boardId);
  const setBoard = useApp((s) => s.setBoard);
  const setPalette = useApp((s) => s.setPalette);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const current = boards.find((b) => b.id === boardId);
  const r = btn.current?.getBoundingClientRect();
  return (
    <>
      <button ref={btn} className="board-btn" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} data-testid="board-menu">
        {current?.name || "Board"} <ChevronDown size={14} />
      </button>
      {open && (
        <>
          <div className="scrim" onClick={() => setOpen(false)} />
          <div className="menu" role="menu" style={{ top: (r?.bottom ?? 40) + 6, left: r?.left ?? 0 }}>
            {boards.map((b) => (
              <button key={b.id} role="menuitem" onClick={() => { setBoard(b.id); setOpen(false); }}>
                <span className="grow ellipsis">{b.name || b.id}</span>
                {b.id === boardId && <Check size={14} />}
              </button>
            ))}
            <hr />
            <button role="menuitem" onClick={() => { setOpen(false); setPalette(true); }}><Plus size={14} /> New board…</button>
            <button role="menuitem" onClick={() => { setOpen(false); importBoardFile(); }}><Upload size={14} /> Import board…</button>
            {!REMOTE && <button role="menuitem" onClick={() => { setOpen(false); void openHermesSetup(); }} data-tip="Draw the agents in ~/.hermes as a board"><FolderOpen size={14} /> Open my Hermes setup</button>}
            {boardId && <button role="menuitem" onClick={() => { setOpen(false); void exportBoardFile(boardId); }}><Download size={14} /> Export this board</button>}
          </div>
        </>
      )}
    </>
  );
}

export function TitleBar() {
  const { graph, peers, boardId } = useBoard();
  const identity = useApp((s) => s.identity);
  const busy = useApp((s) => s.compileBusy);
  const drift = useApp((s) => s.drift);
  const setPalette = useApp((s) => s.setPalette);
  const errors = useMemo(() => (graph.nodes.length ? resolveGraph(graph).issues.filter((i) => i.level === "error").length : 0), [graph]);
  const people = [{ clientId: -1, name: identity.name, color: identity.color }, ...peers];
  const teamOpen = useApp((s) => s.teamOpen);
  const unread = teamOpen ? 0 : unreadCount(boardId, graph.messages, identity.name);

  return (
    <header className="titlebar" data-tauri-drag-region>
      <BrandMark />
      <BoardMenu />
      {DEMO && <span className="chip warn" data-tip="Browser demo: compile is real, runs are simulated" data-tip-side="bottom" data-testid="demo-chip">Demo</span>}
      <div className="spacer" />
      <Island />
      <button className="presence" data-testid="presence" onClick={() => useApp.getState().setTeamOpen(!useApp.getState().teamOpen)}
        data-tip={`${people.length === 1 ? "Only you here" : `${people.length} here`} · team chat`} data-tip-side="bottom">
        {people.slice(0, 5).map((p) => (
          <span key={p.clientId} className="presence-face"><PersonFace name={p.name} color={p.color} size={24} /></span>
        ))}
        {people.length > 5 && <span className="chip">+{people.length - 5}</span>}
        <MessagesSquare size={14} className="faint" />
        {unread > 0 && <span className="unread" data-testid="team-unread">{unread}</span>}
      </button>
      <button className={`btn sm share-btn${REMOTE ? " remote" : ""}`} onClick={() => useApp.getState().setShareOpen(true)} data-testid="share-open"
        data-tip={REMOTE ? `On ${REMOTE.label}'s boards` : "Share on your network"} data-tip-side="bottom">
        <Users size={13} /> {REMOTE ? REMOTE.label : "Share"}
      </button>
      <button className="search-pill" onClick={() => setPalette(true)} data-testid="open-palette">
        <Search size={14} /> <span className="search-label">Search</span> <Kbd>⌘K</Kbd>
      </button>
      <button
        className="btn primary" onClick={() => void compileBoard(boardId)} disabled={busy || graph.nodes.length === 0} data-testid="compile"
        data-tip={errors ? `${errors} problem${errors > 1 ? "s" : ""} on the board` : drift ? `${drift} file${drift > 1 ? "s" : ""} out of date · ⌘S` : "Up to date · ⌘S"} data-tip-side="bottom"
      >
        {busy ? <LoaderCircle size={14} className="spin-icon" /> : <Hammer size={14} />}
        Compile
        {errors > 0 ? <span className="chip fail" style={{ height: 18, background: "rgba(0,0,0,.25)", color: "#fff" }}>{errors}</span>
          : drift ? <span className="chip" style={{ height: 18, background: "rgba(255,255,255,.22)", color: "#fff" }}>{drift}</span> : null}
      </button>
    </header>
  );
}
