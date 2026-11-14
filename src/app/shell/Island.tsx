import { Bot, Check, Hammer, LoaderCircle, MessagesSquare, Search, ShieldAlert, Square, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RunSummary } from "../../contracts/run";
import { compileBoard, stopRun } from "../actions";
import { engine } from "../lib/engine";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { AgentFace, PersonFace, clock, useNow } from "../ui";

/**
 * The dynamic island: always there, in the middle of the title bar.
 *
 * At rest it is a slim pill (a status dot). When something happens it grows, with a spring, into
 * the one thing that matters most right now: an agent asking before a risky action (answer it
 * right there), agents at work (live clock), a compile, a new team message, a notice. It opens into
 * everything at once, with quick actions, as the pointer heads for it (or on click / Enter); it
 * closes when the pointer moves away, or with Esc or a click outside.
 */
type Mode = "rest" | "ask" | "run" | "compile" | "message" | "toast";

function useLatestMessage() {
  const { graph } = useBoard();
  const me = useApp((s) => s.identity.name);
  const last = (graph.messages ?? []).at(-1);
  const [fresh, setFresh] = useState<string | null>(null);
  const seen = useRef<string | null>(last?.id ?? null);
  useEffect(() => {
    if (!last || last.id === seen.current) return;
    seen.current = last.id;
    if (last.author === me && !last.agent) return;
    setFresh(last.id);
    const t = setTimeout(() => setFresh(null), 4500);
    return () => clearTimeout(t);
  }, [last, me]);
  return { last, fresh: fresh && last?.id === fresh ? last : null };
}

export function Island() {
  const { graph, boardId } = useBoard();
  const runs = useApp((s) => s.runs);
  const toasts = useApp((s) => s.toasts);
  const busy = useApp((s) => s.compileBusy);
  const dismiss = useApp((s) => s.dismiss);
  const openChat = useApp((s) => s.openChat);
  const [open, setOpen] = useState(false);
  const shell = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  const running = useMemo(() => Object.values(runs).filter((r) => r.status === "running").sort((a, b) => a.startedAt - b.startedAt), [runs]);
  const asking = running.filter((r) => r.approval);
  const now = useNow(running.length > 0);
  const toast = toasts.at(-1);
  const { last, fresh } = useLatestMessage();
  const nameOf = (r: RunSummary) => {
    const a = graph.nodes.find((n) => n.id === r.agentNodeId);
    return a?.kind === "agent" ? a.data.displayName || a.data.name : r.profile;
  };
  const agents = graph.nodes.filter((n) => n.kind === "agent").length;

  const mode: Mode = asking.length ? "ask" : running.length ? "run" : busy ? "compile" : fresh ? "message" : toast ? "toast" : "rest";

  // Measure the content and animate the pill to it (the morph).
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode, open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!shell.current?.contains(e.target as Node)) { byPointer.current = false; setOpen(false); } };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  // Opens as the pointer comes toward it, before it gets there: the pointer's path is projected
  // a little ahead, and a pill it is about to reach opens now (no hover delay). Close by, the pill
  // leans in. Opened that way, it closes once the pointer has moved clearly away from the panel;
  // opened by click or keyboard, it stays until a click outside or Esc.
  const [near, setNear] = useState(false);
  const byPointer = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    let raf = 0;
    let last: { x: number; y: number; t: number; d: number } | null = null;
    let pending: PointerEvent | null = null;
    let leaveAt = 0;
    let dwell: ReturnType<typeof setTimeout> | null = null;
    const gap = (r: DOMRect, x: number, y: number) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
    const tick = () => {
      raf = 0;
      const e = pending;
      const el = shell.current;
      if (!e || !el) return;
      const r = el.getBoundingClientRect();
      const now = performance.now();
      const d = gap(r, e.clientX, e.clientY);
      // Where the pointer will be in ~140 ms at its current speed, and how fast it goes (px/ms).
      let ahead = d;
      let speed = 0;
      let closing = false;
      if (last && now - last.t > 0 && now - last.t < 120) {
        const dt = now - last.t;
        const k = 140 / dt;
        ahead = gap(r, e.clientX + (e.clientX - last.x) * k, e.clientY + (e.clientY - last.y) * k);
        speed = Math.hypot(e.clientX - last.x, e.clientY - last.y) / dt;
        closing = d < last.d;
      }
      last = { x: e.clientX, y: e.clientY, t: now, d };
      if (!openRef.current) {
        setNear(d < 90);
        // Aimed at it (heading in, not sweeping past), or on it at a walking pace.
        const aimed = closing && ahead < 4 && d < 140 && speed < 1.4;
        const on = d < 10 && speed < 1.6;
        if (aimed || on) {
          byPointer.current = true;
          setOpen(true);
        } else if (d < 10) {
          // Arrived fast and stopped on it: look again once the pointer has settled.
          if (dwell) clearTimeout(dwell);
          dwell = setTimeout(() => { if (!raf) raf = requestAnimationFrame(tick); }, 70);
        }
      } else if (byPointer.current) {
        if (d > 36) {
          leaveAt ||= now;
          if (now - leaveAt > 90) {
            leaveAt = 0;
            byPointer.current = false;
            setOpen(false);
          }
        } else leaveAt = 0;
      }
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      pending = e;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const out = (e: MouseEvent) => {
      // The pointer left the window: let go.
      if (e.relatedTarget) return;
      setNear(false);
      if (openRef.current && byPointer.current) {
        byPointer.current = false;
        setOpen(false);
      }
    };
    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("mouseout", out);
    return () => {
      window.removeEventListener("pointermove", move);
      document.removeEventListener("mouseout", out);
      if (raf) cancelAnimationFrame(raf);
      if (dwell) clearTimeout(dwell);
    };
  }, []);

  const answer = (r: RunSummary, choice: string) => void engine.answerRun(r.runId, choice).catch((err: unknown) => useApp.getState().toast({ kind: "fail", text: String((err as Error).message ?? err) }));
  const go = (fn: () => void) => () => { setOpen(false); fn(); };

  let body: React.ReactNode;
  if (open) {
    body = (
      <div className="island-panel" data-testid="island-panel">
        {asking.map((r) => (
          <div key={r.runId} className="island-sec ask">
            <div className="island-line"><ShieldAlert size={14} className="warn-text" /><b>{nameOf(r)}</b><span className="faint">asks before acting</span></div>
            <code className="island-cmd">{r.approval!.command || r.approval!.description}</code>
            <div className="island-actions">
              <button className="pill primary" onClick={() => answer(r, "once")}>Allow once</button>
              <button className="pill" onClick={() => answer(r, "session")}>For this chat</button>
              <button className="pill danger" onClick={() => answer(r, "deny")}>Deny</button>
            </div>
          </div>
        ))}
        <div className="island-sec">
          <span className="island-label">{running.length ? "Working now" : "All quiet"}</span>
          {running.length === 0 && <span className="faint island-sub">{agents ? `${agents} agent${agents > 1 ? "s" : ""} ready` : "No agents yet"}</span>}
          {running.map((r) => (
            <div key={r.runId} className="island-run">
              <AgentFace seed={r.profile} size={24} status="running" />
              <button className="grow island-link" onClick={go(() => openChat(r.agentNodeId))}><b>{nameOf(r)}</b><span className="faint ellipsis">{r.prompt}</span></button>
              <span className="time">{clock(now - r.startedAt)}</span>
              <button className="icon-btn sm" aria-label="Stop" data-tip="Stop" onClick={() => void stopRun(r.runId)}><Square size={11} /></button>
            </div>
          ))}
        </div>
        {last && (
          <button className="island-sec island-msg" onClick={go(() => useApp.getState().setTeamOpen(true))}>
            <span className="island-label">Team chat</span>
            <span className="island-line">
              {last.agent ? <AgentFace seed={last.agent} size={20} /> : <PersonFace name={last.author} color={last.color || "#888"} size={20} />}
              <b className="nowrap">{last.author}</b><span className="faint ellipsis">{last.text}</span>
            </span>
          </button>
        )}
        <div className="island-quick">
          <button onClick={go(() => useApp.getState().setNewAgentOpen(true))}><Bot size={15} /><span>New agent</span></button>
          <button onClick={go(() => useApp.getState().setPalette(true))}><Search size={15} /><span>Ask</span></button>
          <button onClick={go(() => void compileBoard(boardId))}><Hammer size={15} /><span>Compile</span></button>
          <button onClick={go(() => useApp.getState().setTeamOpen(true))}><MessagesSquare size={15} /><span>Team</span></button>
        </div>
      </div>
    );
  } else if (mode === "ask") {
    const r = asking[0]!;
    body = (
      <div className="island-bar">
        <span className="island-dot warn" />
        <AgentFace seed={r.profile} size={22} status="running" />
        <span><b>{nameOf(r)}</b> <span className="faint">asks</span></span>
        <button className="pill primary" onClick={(e) => { e.stopPropagation(); answer(r, "once"); }}>Allow</button>
        <button className="pill" onClick={(e) => { e.stopPropagation(); answer(r, "deny"); }}>Deny</button>
      </div>
    );
  } else if (mode === "run") {
    const r = running[0]!;
    body = (
      <div className="island-bar">
        <AgentFace seed={r.profile} size={22} status="running" />
        <span>{nameOf(r)}</span>
        {running.length > 1 && <span className="faint">+{running.length - 1}</span>}
        <span className="time">{clock(now - r.startedAt)}</span>
      </div>
    );
  } else if (mode === "compile") {
    body = <div className="island-bar"><LoaderCircle size={14} className="spin-icon" /><span>Compiling</span></div>;
  } else if (mode === "message" && fresh) {
    body = (
      <div className="island-bar">
        {fresh.agent ? <AgentFace seed={fresh.agent} size={22} /> : <PersonFace name={fresh.author} color={fresh.color || "#888"} size={22} />}
        <b>{fresh.author}</b><span className="faint ellipsis" style={{ maxWidth: 300 }}>{fresh.text}</span>
      </div>
    );
  } else if (mode === "toast" && toast) {
    body = (
      <div className="island-bar">
        {toast.kind === "fail" ? <X size={14} className="bad" /> : <Check size={14} className="ok" />}
        <span className="ellipsis" style={{ maxWidth: 420 }}>{toast.text}</span>
        {toast.action && <button className="pill" onClick={(e) => { e.stopPropagation(); toast.action!.run(); dismiss(toast.id); }}>{toast.action.label}</button>}
      </div>
    );
  } else {
    body = <div className="island-bar rest"><span className={`island-dot${agents ? " ok" : ""}`} /></div>;
  }

  return (
    <div className="island-slot">
      <div
        ref={shell}
        className={`island${open ? " open" : ""}${near ? " near" : ""} mode-${mode}`}
        style={size ? { width: size.w, height: size.h } : undefined}
        role="button" tabIndex={0} aria-expanded={open} aria-label="McBot status"
        
        onClick={() => { if (!open) { byPointer.current = false; setOpen(true); } else byPointer.current = false; }}
        onKeyDown={(e) => { if (!open && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); byPointer.current = false; setOpen(true); } }}
        data-testid="island"
      >
        <div ref={inner} className="island-inner" key={open ? "open" : mode}>{body}</div>
      </div>
    </div>
  );
}
