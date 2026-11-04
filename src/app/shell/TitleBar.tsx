import { Check, ChevronDown, Hammer, LoaderCircle, Plus, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { resolveGraph } from "../../compile";
import { compileBoard } from "../actions";
import { DEMO } from "../lib/engine";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { Kbd, PersonFace } from "../ui";
import { Island } from "./Island";

export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <div className="brand-mark" style={{ width: size, height: size }} aria-hidden>
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
        <path d="M6 12h4M14 12h4" />
        <circle cx="4" cy="12" r="2.2" fill="currentColor" stroke="none" />
        <rect x="9.5" y="7.5" width="5" height="9" rx="2" fill="currentColor" stroke="none" />
        <circle cx="20" cy="12" r="2.2" fill="currentColor" stroke="none" />
      </svg>
    </div>
  );
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

  return (
    <header className="titlebar" data-tauri-drag-region>
      <BrandMark />
      <BoardMenu />
      {DEMO && <span className="chip warn" data-tip="Browser demo: compile is real, runs are simulated" data-tip-side="bottom" data-testid="demo-chip">Demo</span>}
      <div className="spacer" />
      <Island />
      <div className="presence" data-testid="presence">
        {people.slice(0, 5).map((p) => (
          <span key={p.clientId} data-tip={p.clientId === -1 ? `${p.name} (you)` : p.name} data-tip-side="bottom">
            <PersonFace name={p.name} color={p.color} size={24} />
          </span>
        ))}
      </div>
      <button className="search-pill" onClick={() => setPalette(true)} data-testid="open-palette">
        <Search size={14} /> Search <Kbd>⌘K</Kbd>
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
