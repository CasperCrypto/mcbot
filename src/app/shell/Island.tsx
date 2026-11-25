import { applyFix } from "./DoctorSheet";
import type { Finding } from "../graph/doctor";
import { ArrowUp, Bot, CalendarClock, Check, Copy, Hammer, LoaderCircle, MessagesSquare, Minus, Search, ShieldAlert, Square, SquareDashed, UserPlus, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentSchedules, CostReport } from "../../contracts/api";
import type { RunSummary } from "../../contracts/run";
import { compileBoard, runAgent, stopRun } from "../actions";
import { inApp, onMaximized, windowAct } from "../lib/desktop";
import { engine } from "../lib/engine";
import { usd } from "../lib/format";
import { agentsOf } from "../lib/models";
import { stepOf } from "../lib/runStep";
import { utcDay } from "../lib/series";
import { Logo } from "../faces/FoodFace";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { AgentFace, PersonFace, clock, useNow } from "../ui";
import { Picker } from "../Picker";
import { agentOptions } from "../lib/agentOptions";

/**
 * The dynamic island: always there, in the middle of the title bar.
 *
 * At rest it is a pill that says how things are (agents ready, or what one is doing). When
 * something happens it grows, with a spring, into the one thing that matters most right now: an
 * agent asking before a risky action (answer it right there), agents at work (what each is doing,
 * live), a compile, a new team message, a notice. It opens into everything at once when the
 * pointer rests on it, or on click / Enter: what needs you, who is working on what, today's spend
 * and what runs next, a field to ask any agent, quick actions, and the window's own buttons. It
 * never opens because the pointer passes by on its way to something under it. Opened by hovering,
 * it closes when the pointer leaves; opened by click, on Esc or a click outside.
 */
type Mode = "rest" | "ask" | "run" | "compile" | "message" | "toast" | "problems";

/** How long the pointer rests on the pill before it opens, and how long it may wander off before it closes. */
const OPEN_AFTER_MS = 240;
const CLOSE_AFTER_MS = 320;

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

/** Today's spend and the next scheduled run, asked of the engine each time the island opens. */
function useToday(open: boolean, boardId: string) {
  const [spent, setSpent] = useState<number | null>(null);
  const [next, setNext] = useState<{ name: string; profile: string; at: number } | null>(null);
  useEffect(() => {
    if (!open || !boardId) return;
    let live = true;
    engine.cost(boardId).then((c: CostReport) => {
      if (live) setSpent(c.byDay.find((d) => d.key === utcDay(Date.now()))?.usd ?? 0);
    }).catch(() => undefined);
    engine.schedules(boardId).then((all: AgentSchedules[]) => {
      const jobs = all.flatMap((a) => a.schedules.filter((j) => j.enabled && j.nextRunAt).map((j) => ({ name: j.name || j.prompt || "Scheduled run", profile: a.profile, at: j.nextRunAt! })));
      if (live) setNext(jobs.sort((a, b) => a.at - b.at)[0] ?? null);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [open, boardId]);
  return { spent, next };
}

function when(ts: number): string {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  return `${sameDay ? "" : `${d.toLocaleDateString([], { weekday: "short" })} `}${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

/** Minimize and maximize the whole window, from the island (the app's own window only). */
function WindowButtons() {
  const [max, setMax] = useState(false);
  useEffect(() => {
    let off: (() => void) | undefined;
    let live = true;
    void onMaximized(setMax).then((f) => { if (live) off = f; else f(); });
    return () => { live = false; off?.(); };
  }, []);
  if (!inApp()) return null;
  return (
    <div className="island-win" role="group" aria-label="Window">
      <button type="button" className="island-icon" aria-label="Minimize" data-tip="Minimize" data-tip-side="bottom" onClick={() => void windowAct("min")}><Minus size={15} /></button>
      <button type="button" className="island-icon" aria-label={max ? "Restore" : "Maximize"} data-tip={max ? "Restore" : "Maximize"} data-tip-side="bottom" onClick={() => void windowAct("max")}>
        {max ? <Copy size={13} /> : <SquareDashed size={14} />}
      </button>
    </div>
  );
}

export function Island({ findings = [] }: { findings?: Finding[] }) {
  const { graph, boardId, doc } = useBoard();
  const notices = useApp((s) => s.notices);
  const clearNotices = useApp((s) => s.clearNotices);
  const problems = findings.filter((f) => f.level !== "tip");
  const problemErrors = problems.filter((f) => f.level === "error").length;
  const runs = useApp((s) => s.runs);
  const events = useApp((s) => s.events);
  const toasts = useApp((s) => s.toasts);
  const busy = useApp((s) => s.compileBusy);
  const dismiss = useApp((s) => s.dismiss);
  const openChat = useApp((s) => s.openChat);
  const chatAgentId = useApp((s) => s.chatAgentId);
  const [open, setOpen] = useState(false);
  const shell = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  const running = useMemo(() => Object.values(runs).filter((r) => r.status === "running").sort((a, b) => a.startedAt - b.startedAt), [runs]);
  const asking = running.filter((r) => r.approval);
  const now = useNow(running.length > 0);
  const toast = toasts.at(-1);
  const { last, fresh } = useLatestMessage();
  const agents = agentsOf(graph);
  const nameOf = (r: RunSummary) => {
    const a = agents.find((n) => n.id === r.agentNodeId);
    return a ? a.data.displayName || a.data.name : r.profile;
  };
  const { spent, next } = useToday(open, boardId);
  const midnight = new Date().setHours(0, 0, 0, 0);
  const runsToday = Object.values(runs).filter((r) => r.startedAt >= midnight).length;

  // A notice (a compile that failed and its Fix) comes before a team message: it is what was just done.
  const mode: Mode = asking.length ? "ask" : running.length ? "run" : busy ? "compile" : toast ? "toast" : fresh ? "message" : problemErrors ? "problems" : "rest";

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

  // Opened by hovering: it follows the pointer. Opened by click or keyboard: it stays until Esc or a click outside.
  const byHover = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (!open) return;
    // A click in its own menu (a picker's list is drawn on the page, outside the island) keeps it open.
    const away = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (shell.current?.contains(t) || t?.closest?.(".menu")) return;
      byHover.current = false;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { byHover.current = false; setOpen(false); } };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  useEffect(() => {
    const el = shell.current;
    if (!el) return;
    let enterT: ReturnType<typeof setTimeout> | undefined;
    let leaveT: ReturnType<typeof setTimeout> | undefined;
    const enter = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      clearTimeout(leaveT);
      if (!openRef.current) enterT = setTimeout(() => { byHover.current = true; setOpen(true); }, OPEN_AFTER_MS);
    };
    const leave = () => {
      clearTimeout(enterT);
      if (!openRef.current || !byHover.current) return;
      leaveT = setTimeout(() => {
        // Typing in its field, or a menu of its own open: stay.
        if (el.contains(document.activeElement) && document.activeElement !== el) return;
        if (document.activeElement?.closest(".pick-menu")) return;
        byHover.current = false;
        setOpen(false);
      }, CLOSE_AFTER_MS);
    };
    el.addEventListener("pointerenter", enter);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointerenter", enter);
      el.removeEventListener("pointerleave", leave);
      clearTimeout(enterT);
      clearTimeout(leaveT);
    };
  }, []);

  const answer = (r: RunSummary, choice: string) => void engine.answerRun(r.runId, choice).catch((err: unknown) => useApp.getState().toast({ kind: "fail", text: String((err as Error).message ?? err) }));
  const go = (fn: () => void) => () => { byHover.current = false; setOpen(false); fn(); };

  // Ask any agent from here: straight away, or in its queue while it works (as the chat does).
  const [askTo, setAskTo] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const target = agents.find((a) => a.id === askTo) ?? agents.find((a) => a.id === chatAgentId) ?? agents[0];
  const ask = async () => {
    const prompt = draft.trim();
    if (!target || !prompt) return;
    setDraft("");
    const s = useApp.getState();
    const busyAgent = running.some((r) => r.agentNodeId === target.id) || s.starting[target.id] || (s.queue[target.id]?.items.length ?? 0) > 0;
    if (busyAgent) { s.enqueue(target.id, prompt); return; }
    const id = await runAgent(boardId, target.id, prompt);
    if (!id) setDraft(prompt);
  };

  let body: React.ReactNode;
  if (open) {
    const needs = asking.length + problems.length;
    body = (
      <div className="island-panel" data-testid="island-panel">
        <div className="island-head">
          <Logo size={18} />
          <span className="island-title">{needs ? `${needs} need${needs === 1 ? "s" : ""} you` : running.length ? `${running.length} at work` : "All quiet"}</span>
          <span className="island-meta">{new Date().toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</span>
          <span className="grow" />
          <WindowButtons />
        </div>

        {agents.length > 0 && (
          <form className="island-ask" onSubmit={(e) => { e.preventDefault(); void ask(); }} data-testid="island-ask">
            <Picker sm className="island-picker" label="Agent" tip="Who to ask" value={target?.id ?? ""} onChange={setAskTo} options={agentOptions(agents)} />
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Ask ${target ? target.data.displayName || target.data.name : "an agent"}…`} aria-label="Ask" data-testid="island-ask-input" />
            <button type="submit" className="island-send" disabled={!draft.trim()} aria-label="Send"><ArrowUp size={15} /></button>
          </form>
        )}

        {asking.map((r) => (
          <div key={r.runId} className="island-sec ask">
            <div className="island-line"><ShieldAlert size={15} className="warn-text" /><b>{nameOf(r)}</b><span className="faint">asks before acting</span></div>
            <code className="island-cmd">{r.approval!.command || r.approval!.description}</code>
            <div className="island-actions">
              <button className="pill primary" onClick={() => answer(r, "once")}>Allow once</button>
              <button className="pill" onClick={() => answer(r, "session")}>For this chat</button>
              <button className="pill danger" onClick={() => answer(r, "deny")}>Deny</button>
            </div>
          </div>
        ))}

        <div className="island-grid">
          <div className="island-sec">
            <span className="island-label">{running.length ? "Working now" : "Agents"}</span>
            {running.length === 0 && (
              agents.length ? (
                <div className="island-faces">
                  {agents.slice(0, 6).map((a) => (
                    <button key={a.id} className="island-face" onClick={go(() => openChat(a.id))} data-tip={`Chat with ${a.data.displayName || a.data.name}`}>
                      <AgentFace seed={a.data.name} size={26} />
                      <span className="ellipsis">{a.data.displayName || a.data.name}</span>
                    </button>
                  ))}
                </div>
              ) : <span className="faint island-sub">No agents yet</span>
            )}
            {running.map((r) => (
              <div key={r.runId} className="island-run">
                <AgentFace seed={r.profile} size={26} status="running" />
                <button className="grow island-link" onClick={go(() => openChat(r.agentNodeId))}>
                  <b>{nameOf(r)}</b>
                  <span className="faint ellipsis">{stepOf(events[r.runId])} · {r.prompt.split("\n")[0]}</span>
                </button>
                <span className="time">{clock(now - r.startedAt)}</span>
                <button className="island-icon" aria-label="Stop" data-tip="Stop" onClick={() => void stopRun(r.runId)}><Square size={11} /></button>
              </div>
            ))}
          </div>
          <div className="island-sec island-today" data-testid="island-today">
            <span className="island-label">Today</span>
            <div className="island-stats">
              <span><b className="num">{spent === null ? "…" : usd(spent)}</b><small>spent</small></span>
              <span><b className="num">{runsToday}</b><small>{runsToday === 1 ? "run" : "runs"}</small></span>
            </div>
            {next && (
              <span className="island-next"><CalendarClock size={13} /><span className="ellipsis"><b>{when(next.at)}</b> {next.name}</span></span>
            )}
          </div>
        </div>

        {problems.length > 0 && (
          <div className="island-sec" data-testid="island-problems">
            <span className="island-label">{problems.length === 1 ? "1 thing to fix" : `${problems.length} things to fix`}</span>
            {problems.slice(0, 4).map((f) => (
              <div key={f.id} className={`island-notice ${f.level === "error" ? "fail" : "warn"}`}>
                <span className={`island-mark ${f.level === "error" ? "fail" : "warn"}`} />
                <span className="grow island-notice-text">{f.title}</span>
                <button className="pill" onClick={go(() => applyFix(f, boardId, doc))}>{f.fix.label}</button>
              </div>
            ))}
            {problems.length > 4 && <button className="island-link faint" onClick={go(() => useApp.getState().setDoctorOpen(true))}>All {problems.length}…</button>}
          </div>
        )}
        {notices.length > 0 && (
          <div className="island-sec" data-testid="island-notices">
            <div className="island-line"><span className="island-label grow">Notices</span><button className="island-link faint" onClick={() => clearNotices()}>Clear</button></div>
            {notices.slice(0, 3).map((n) => (
              <div key={n.id} className={`island-notice ${n.kind}`}>
                {n.kind === "fail" ? <X size={14} className="bad" /> : <Check size={14} className="ok" />}
                <span className="grow island-notice-text">{n.text}</span>
                {n.action && <button className="pill" onClick={go(() => n.action!.run())}>{n.action.label}</button>}
              </div>
            ))}
          </div>
        )}
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
          <button onClick={go(() => useApp.getState().setBuilder(true))}><Logo size={17} /><span>Build a team</span></button>
          <button onClick={go(() => useApp.getState().setNewAgentOpen(true))}><Bot size={16} /><span>New agent</span></button>
          <button onClick={go(() => void compileBoard(boardId))}><Hammer size={16} /><span>Compile</span></button>
          <button onClick={go(() => useApp.getState().setShareOpen(true))}><UserPlus size={16} /><span>Invite</span></button>
          <button onClick={go(() => useApp.getState().setTeamOpen(true))}><MessagesSquare size={16} /><span>Team</span></button>
          <button onClick={go(() => useApp.getState().setPalette(true))}><Search size={16} /><span>Commands</span></button>
        </div>
      </div>
    );
  } else if (mode === "ask") {
    const r = asking[0]!;
    body = (
      <div className="island-bar">
        <span className="island-dot warn" />
        <AgentFace seed={r.profile} size={22} status="running" />
        <span className="ellipsis" style={{ maxWidth: 260 }}><b>{nameOf(r)}</b> <span className="faint">asks: {r.approval!.command || r.approval!.description}</span></span>
        <button className="pill primary" onClick={(e) => { e.stopPropagation(); answer(r, "once"); }}>Allow</button>
        <button className="pill" onClick={(e) => { e.stopPropagation(); answer(r, "deny"); }}>Deny</button>
      </div>
    );
  } else if (mode === "run") {
    const r = running[0]!;
    body = (
      <div className="island-bar">
        <AgentFace seed={r.profile} size={22} status="running" />
        <b>{nameOf(r)}</b>
        <span className="faint ellipsis" style={{ maxWidth: 220 }}>{stepOf(events[r.runId])}</span>
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
        <b>{fresh.author}</b><span className="faint ellipsis" style={{ maxWidth: 320 }}>{fresh.text}</span>
      </div>
    );
  } else if (mode === "toast" && toast) {
    body = (
      <div className="island-bar">
        {toast.kind === "fail" ? <X size={14} className="bad" /> : <Check size={14} className="ok" />}
        <span className="ellipsis" style={{ maxWidth: 440 }}>{toast.text}</span>
        {toast.action && <button className="pill" onClick={(e) => { e.stopPropagation(); toast.action!.run(); dismiss(toast.id); }}>{toast.action.label}</button>}
      </div>
    );
  } else if (mode === "problems") {
    body = <div className="island-bar"><span className="island-mark fail" /><span>{problemErrors === 1 ? "1 thing to fix" : `${problemErrors} things to fix`}</span></div>;
  } else {
    body = (
      <div className="island-bar rest">
        <span className={`island-dot${agents.length ? " ok" : ""}`} />
        <span className="faint">{agents.length ? `${agents.length} agent${agents.length > 1 ? "s" : ""} ready` : "McBot"}</span>
      </div>
    );
  }

  return (
    <div className="island-slot">
      <div
        ref={shell}
        className={`island${open ? " open" : ""} mode-${mode}`}
        style={size ? { width: size.w, height: size.h } : undefined}
        role="button" tabIndex={0} aria-expanded={open} aria-label="McBot status"
        onClick={() => { if (!open) { byHover.current = false; setOpen(true); } else byHover.current = false; }}
        onKeyDown={(e) => { if (!open && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); byHover.current = false; setOpen(true); } }}
        data-testid="island"
      >
        <div ref={inner} className="island-inner" key={open ? "open" : mode}>{body}</div>
      </div>
    </div>
  );
}
