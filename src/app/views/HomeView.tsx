import { ArrowUp, Check, CircleAlert, CircleDashed, Clock, Hammer, ListChecks, Pause, Play, Plus, RotateCcw, Square, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AgentSchedules, CostReport, TaskView } from "../../contracts/api";
import type { AgentNode } from "../../contracts/graph";
import type { RunEvent, RunSummary } from "../../contracts/run";
import { compileBoard, runAgent } from "../actions";
import { engine } from "../lib/engine";
import { ago, usd } from "../lib/format";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { AgentFace, Segmented } from "../ui";
import { NOTE_COLORS, type Note } from "../../contracts/graph";
import { addNote } from "../../board/ydoc";
import { newId } from "../graph/defaults";
import { StickyNote } from "../notes/StickyNote";
import { useTasks } from "./TasksView";
import { ApprovalCard } from "../approvals/ApprovalCard";

const DAY = 86_400_000;

/** What a running agent is doing right now, from its live events. */
function stepOf(events: RunEvent[] | undefined): string {
  const open = new Map<string, number>();
  for (const e of events ?? []) {
    if (e.type === "run.tool.started") open.set(e.tool, (open.get(e.tool) ?? 0) + 1);
    if (e.type === "run.tool.finished") open.set(e.tool, Math.max(0, (open.get(e.tool) ?? 1) - 1));
  }
  const tool = [...open].reverse().find(([, n]) => n > 0)?.[0];
  if (tool) return `Using ${tool.replace(/^mcp__([^_]+)__/, "$1 · ")}`;
  return (events ?? []).some((e) => e.type === "run.text") ? "Writing…" : "Thinking…";
}

interface Item {
  key: string;
  at: number;
  face: ReactNode;
  title: string;
  sub: string;
  tone: "warn" | "fail" | "";
  action?: { label: string; icon: ReactNode; run: () => void };
  open: () => void;
}

function Ask({ agents }: { agents: AgentNode[] }) {
  const { boardId } = useBoard();
  const identity = useApp((s) => s.identity);
  const [agent, setAgent] = useState<string>(agents[0]?.id ?? "");
  const [mode, setMode] = useState<"ask" | "task">("ask");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!agents.some((a) => a.id === agent)) setAgent(agents[0]?.id ?? "");
  }, [agents, agent]);
  const chosen = agents.find((a) => a.id === agent);
  const send = async () => {
    if (!chosen || !text.trim() || busy) return;
    setBusy(true);
    try {
      if (mode === "ask") {
        const runId = await runAgent(boardId, chosen.id, text.trim());
        if (runId) {
          setText("");
          useApp.getState().openChat(chosen.id);
        }
      } else {
        const t = await engine.createTask(boardId, { title: text.trim().split("\n")[0]!.slice(0, 300), body: text.trim(), assignee: chosen.data.name, by: identity.name });
        setText("");
        useApp.getState().toast({ kind: "ok", text: `Task added for ${chosen.data.displayName || chosen.data.name}`, action: { label: "Open", run: () => useApp.getState().showTask(t.id) } });
      }
    } catch (err) {
      useApp.getState().toast({ kind: "fail", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  if (agents.length === 0) return null;
  return (
    <div className="ask" data-testid="home-ask">
      <div className="ask-agents" role="radiogroup" aria-label="Agent">
        {agents.map((a) => (
          <button key={a.id} role="radio" aria-checked={a.id === agent} className="ask-agent" onClick={() => setAgent(a.id)} data-tip={a.data.displayName || a.data.name}>
            <AgentFace seed={a.data.name} size={26} />
          </button>
        ))}
      </div>
      <div className="composer">
        <textarea rows={1} value={text} onChange={(e) => setText(e.target.value)} data-testid="home-ask-input"
          placeholder={chosen ? `${mode === "ask" ? "Ask" : "Give"} ${chosen.data.displayName || chosen.data.name}${mode === "ask" ? "…" : " a task…"}` : ""}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <div style={{ width: 132 }}><Segmented value={mode} onChange={setMode} options={[{ value: "ask", label: "Ask" }, { value: "task", label: "Task" }]} /></div>
        <button className="send" aria-label="Send" disabled={!text.trim() || busy} onClick={() => void send()}><ArrowUp size={16} /></button>
      </div>
    </div>
  );
}


/** Hermes' schedule grammar ('every 2h', '0 9 * * *'): the common ones as presets. */
const WHEN = [
  { value: "every 1h", label: "Hourly" },
  { value: "0 9 * * *", label: "Daily 9:00" },
  { value: "0 9 * * 1-5", label: "Weekdays" },
  { value: "custom", label: "Custom" },
] as const;

function when(ts: number | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  return `${sameDay ? "Today" : d.toLocaleDateString([], { weekday: "short" })} ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function Schedules({ agents }: { agents: AgentNode[] }) {
  const { boardId } = useBoard();
  const [data, setData] = useState<AgentSchedules[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [profile, setProfile] = useState(agents[0]?.data.name ?? "");
  const [preset, setPreset] = useState<(typeof WHEN)[number]["value"]>("0 9 * * 1-5");
  const [custom, setCustom] = useState("");
  const [prompt, setPrompt] = useState("");
  const toast = useApp((s) => s.toast);
  useEffect(() => {
    let alive = true;
    const load = () => engine.schedules(boardId).then((d) => { if (alive) setData(d); }).catch(() => undefined);
    void load();
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [boardId]);
  const merge = (one: AgentSchedules) => setData((d) => [...(d ?? []).filter((x) => x.profile !== one.profile), one]);
  const run = async (f: () => Promise<AgentSchedules>) => {
    try {
      merge(await f());
      return true;
    } catch (err) {
      toast({ kind: "fail", text: (err as Error).message });
      return false;
    }
  };
  const add = async () => {
    const w = preset === "custom" ? custom.trim() : preset;
    if (!profile || !w || !prompt.trim()) return;
    if (await run(() => engine.createSchedule(boardId, { profile, when: w, prompt: prompt.trim(), name: prompt.trim().split("\n")[0]!.slice(0, 60) }))) {
      setPrompt("");
      setAdding(false);
    }
  };
  const jobs = (data ?? []).flatMap((a) => a.schedules.map((j) => ({ ...j, profile: a.profile })))
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity));
  const nameOf = (p: string) => agents.find((a) => a.data.name === p)?.data.displayName || p;
  return (
    <section className="card home-card" data-testid="home-schedules">
      <div className="home-card-head">
        <h2>Scheduled</h2><span className="grow" />
        <button className="icon-btn sm" aria-label={adding ? "Close" : "New schedule"} data-tip={adding ? undefined : "New schedule"} onClick={() => setAdding(!adding)} data-testid="schedule-add">{adding ? <X size={13} /> : <Plus size={14} />}</button>
      </div>
      {adding && (
        <div className="stack schedule-form" style={{ gap: 10 }}>
          <select value={profile} onChange={(e) => setProfile(e.target.value)} aria-label="Agent">
            {agents.map((a) => <option key={a.id} value={a.data.name}>{a.data.displayName || a.data.name}</option>)}
          </select>
          <Segmented value={preset} onChange={setPreset} options={WHEN.map((w) => ({ value: w.value, label: w.label }))} />
          {preset === "custom" && <input className="mono" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="every 2h · 30m · 0 9 * * 1" aria-label="Schedule" data-tip="'every 2h', '30m' (once), or a cron line" />}
          <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What to do each time" aria-label="What to do" data-testid="schedule-prompt" />
          <div className="row"><span className="grow" /><button className="btn sm primary" disabled={!prompt.trim() || (preset === "custom" && !custom.trim())} onClick={() => void add()} data-testid="schedule-create">Schedule</button></div>
        </div>
      )}
      {jobs.length === 0 && !adding ? <div className="home-empty"><Clock size={14} /> Nothing scheduled</div> : jobs.map((j) => (
        <div key={j.id} className="home-row schedule-row" data-enabled={j.enabled}>
          <div className="home-row-main" data-tip={j.lastError ?? undefined}>
            <AgentFace seed={j.profile} size={30} status={j.lastStatus === "error" ? "failed" : null} />
            <span className="grow" style={{ display: "grid", gap: 1 }}>
              <span className="title ellipsis">{j.name || j.prompt}</span>
              <span className="sub ellipsis">{nameOf(j.profile)} · {j.enabled ? (when(j.nextRunAt) || j.when) : "Paused"}</span>
            </span>
          </div>
          <span className="schedule-actions">
            <button className="icon-btn sm" aria-label="Run now" data-tip="Run now" onClick={() => void run(() => engine.actOnSchedule(boardId, j.profile, j.id, "run"))}><Play size={12} /></button>
            <button className="icon-btn sm" aria-label={j.enabled ? "Pause" : "Resume"} data-tip={j.enabled ? "Pause" : "Resume"} onClick={() => void run(() => engine.actOnSchedule(boardId, j.profile, j.id, j.enabled ? "pause" : "resume"))}>{j.enabled ? <Pause size={12} /> : <RotateCcw size={12} />}</button>
            <button className="icon-btn sm" aria-label="Remove" data-tip="Remove" onClick={() => void run(() => engine.actOnSchedule(boardId, j.profile, j.id, "remove"))}><Trash2 size={12} /></button>
          </span>
        </div>
      ))}
    </section>
  );
}

/** Pinned sticky notes from the board, and a card to add one (also placed on the canvas). */
function Notes() {
  const { doc, graph } = useBoard();
  const identity = useApp((s) => s.identity);
  const pinned = (graph.notes ?? []).filter((n) => n.pinned).sort((a, b) => b.at - a.at);
  const add = () => {
    // On the canvas, notes from Home stack in a column left of everything, never over an agent.
    const left = Math.min(0, ...graph.nodes.map((n) => n.position.x)) - 300;
    const fromHome = (graph.notes ?? []).filter((n) => n.position.x === left).length;
    const note: Note = { id: newId("note"), text: "", color: NOTE_COLORS[(graph.notes?.length ?? 0) % 4]!, position: { x: Math.round(left), y: fromHome * 200 }, pinned: true, author: identity.name, at: Date.now() };
    addNote(doc, note);
    useApp.getState().setFreshNote(note.id);
  };
  return (
    <section className="notes-grid" data-testid="home-notes" aria-label="Notes">
      {pinned.map((n) => <StickyNote key={n.id} note={n} />)}
      <button className="sticky-add" onClick={add} data-testid="note-add"><span className="row" style={{ gap: 6 }}><Plus size={14} /> Note</span></button>
    </section>
  );
}

export function HomeView() {
  const { boardId, graph } = useBoard();
  const identity = useApp((s) => s.identity);
  const runs = useApp((s) => s.runs);
  const events = useApp((s) => s.events);
  const drift = useApp((s) => s.drift);
  const { tasks } = useTasks(boardId, 4000);
  const [cost, setCost] = useState<CostReport | null>(null);
  const agents = useMemo(() => graph.nodes.filter((n): n is AgentNode => n.kind === "agent"), [graph]);
  const nameOf = (profile: string | null) => {
    const a = agents.find((x) => x.data.name === profile);
    return a ? a.data.displayName || a.data.name : profile ?? "Nobody";
  };
  const finished = Object.values(runs).filter((r) => r.status !== "running").length;
  useEffect(() => {
    engine.cost(boardId).then(setCost).catch(() => undefined);
  }, [boardId, finished]);

  const list = useMemo(() => Object.values(runs).sort((a, b) => b.startedAt - a.startedAt), [runs]);
  const live = list.filter((r) => r.status === "running");
  const working = (tasks ?? []).filter((t) => t.status === "running");
  const since = Date.now() - DAY;

  const app = useApp.getState();
  const act = async (t: TaskView, a: "complete" | "unblock") => {
    try {
      await engine.actOnTask(boardId, t.id, identity.name, { action: a });
    } catch (err) {
      app.toast({ kind: "fail", text: (err as Error).message });
    }
  };
  const retry = (r: RunSummary) => void runAgent(boardId, r.agentNodeId, r.prompt);

  // Needs you: one line each, one action.
  const inbox: Item[] = [
    ...(drift ? [{
      key: "compile", at: Date.now(), face: <span className="tile sm agent"><Hammer size={14} /></span>, title: `${drift} file${drift > 1 ? "s" : ""} differ from the board`, sub: "Agents run what was last compiled", tone: "warn" as const,
      action: { label: "Compile", icon: <Hammer size={12} />, run: () => void compileBoard(boardId) }, open: () => app.setTab("graph"),
    }] : []),
    ...(tasks ?? []).filter((t) => t.status === "review").map((t): Item => ({
      key: t.id, at: t.startedAt ?? t.createdAt, face: <AgentFace seed={t.assignee ?? "task"} size={30} />, title: t.title, sub: `${nameOf(t.assignee)} asks for a review`, tone: "warn",
      action: { label: "Approve", icon: <Check size={12} />, run: () => void act(t, "complete") }, open: () => app.showTask(t.id),
    })),
    ...(tasks ?? []).filter((t) => t.status === "blocked").map((t): Item => ({
      key: t.id, at: t.createdAt, face: <AgentFace seed={t.assignee ?? "task"} size={30} status="failed" />, title: t.title, sub: t.error ?? `${nameOf(t.assignee)} is blocked`, tone: "fail",
      action: { label: "Unblock", icon: <RotateCcw size={12} />, run: () => void act(t, "unblock") }, open: () => app.showTask(t.id),
    })),
    ...(tasks ?? []).filter((t) => !t.assignee && t.status !== "done").map((t): Item => ({
      key: t.id, at: t.createdAt, face: <span className="tile sm agent"><CircleDashed size={14} /></span>, title: t.title, sub: "Nobody has it yet", tone: "",
      action: { label: "Assign", icon: <ListChecks size={12} />, run: () => app.showTask(t.id) }, open: () => app.showTask(t.id),
    })),
    ...list.filter((r) => r.status === "failed" && r.startedAt > since).slice(0, 5).map((r): Item => ({
      key: r.runId, at: r.finishedAt ?? r.startedAt, face: <AgentFace seed={r.profile} size={30} status="failed" />, title: r.prompt.split("\n")[0]!.slice(0, 120), sub: `${nameOf(r.profile)} failed: ${r.error ?? "see the run"}`, tone: "fail",
      action: { label: "Retry", icon: <RotateCcw size={12} />, run: () => retry(r) }, open: () => { app.selectRun(r.runId); app.setTab("workflows"); },
    })),
  ];

  // Finished lately: answers and done tasks, newest first.
  const recent = [
    ...list.filter((r) => r.status === "succeeded").slice(0, 6).map((r) => ({ key: r.runId, at: r.finishedAt ?? r.startedAt, profile: r.profile, title: r.prompt.split("\n")[0]!, sub: r.text.split("\n")[0] ?? "", open: () => app.openChat(r.agentNodeId) })),
    ...(tasks ?? []).filter((t) => t.status === "done").slice(0, 6).map((t) => ({ key: t.id, at: t.completedAt ?? t.createdAt, profile: t.assignee ?? "task", title: t.title, sub: t.result ?? "Done", open: () => app.showTask(t.id) })),
  ].sort((a, b) => b.at - a.at).slice(0, 6);

  const today = cost?.byDay.find((d) => d.key === new Date().toISOString().slice(0, 10));
  const runsToday = list.filter((r) => r.startedAt > new Date().setHours(0, 0, 0, 0)).length;
  const doneToday = (tasks ?? []).filter((t) => t.status === "done" && (t.completedAt ?? 0) > new Date().setHours(0, 0, 0, 0)).length;

  return (
    <section className="main flush-left">
      <div className="scroll-page home" data-testid="home">
        <div className="home-inner">
          <Notes />
          <Ask agents={agents} />

          <div className="home-grid">
            <div className="stack" style={{ gap: 14 }}>
              <section className="card home-card" data-testid="home-inbox">
                <div className="home-card-head"><h2>Needs you</h2>{inbox.length + list.filter((r) => r.approval).length > 0 && <span className="chip warn num">{inbox.length + list.filter((r) => r.approval).length}</span>}</div>
                {list.filter((r) => r.approval).map((r) => (
                  <div key={`ask-${r.runId}`} className="home-ask-row" data-testid="home-approval">
                    <div className="row" style={{ gap: 8, padding: "2px 2px 6px" }}>
                      <AgentFace seed={r.profile} size={22} status="running" />
                      <span className="title ellipsis grow">{nameOf(r.profile)} asks before acting</span>
                      <button className="btn sm ghost" onClick={() => app.openChat(r.agentNodeId)}>Open chat</button>
                    </div>
                    <ApprovalCard run={r} compact />
                  </div>
                ))}
                {inbox.length === 0 && !list.some((r) => r.approval) ? <div className="home-empty"><Check size={14} /> Nothing waiting on you</div> : inbox.map((i) => (
                  <div key={i.key} className="home-row" data-tone={i.tone}>
                    <button className="home-row-main" onClick={i.open}>
                      {i.face}
                      <span className="grow" style={{ display: "grid", gap: 1 }}>
                        <span className="title ellipsis">{i.title}</span>
                        <span className="sub ellipsis">{i.sub}</span>
                      </span>
                    </button>
                    {i.action && <button className={`btn sm${i.tone === "warn" ? " primary" : ""}`} onClick={i.action.run}>{i.action.icon}{i.action.label}</button>}
                  </div>
                ))}
              </section>

              <section className="card home-card">
                <div className="home-card-head"><h2>Finished</h2></div>
                {recent.length === 0 ? <div className="home-empty">Answers and done tasks show up here</div> : recent.map((r) => (
                  <button key={r.key} className="home-row home-row-main" onClick={r.open}>
                    <AgentFace seed={r.profile} size={30} status="succeeded" />
                    <span className="grow" style={{ display: "grid", gap: 1 }}>
                      <span className="title ellipsis">{r.title}</span>
                      <span className="sub ellipsis">{r.sub}</span>
                    </span>
                    <span className="faint" style={{ fontSize: 11 }}>{ago(r.at)}</span>
                  </button>
                ))}
              </section>
            </div>

            <div className="stack" style={{ gap: 14 }}>
              <section className="card home-card" data-testid="home-live">
                <div className="home-card-head"><h2>Working now</h2>{live.length + working.length > 0 && <span className="dot run" />}</div>
                {live.length + working.length === 0 ? <div className="home-empty">Everyone is free</div> : (
                  <>
                    {live.map((r) => (
                      <div key={r.runId} className="home-row">
                        <button className="home-row-main" onClick={() => app.openChat(r.agentNodeId)}>
                          <AgentFace seed={r.profile} size={30} status="running" />
                          <span className="grow" style={{ display: "grid", gap: 1 }}>
                            <span className="title ellipsis">{nameOf(r.profile)}</span>
                            <span className="sub ellipsis">{stepOf(events[r.runId])}</span>
                          </span>
                        </button>
                        <button className="icon-btn sm" aria-label="Stop" data-tip="Stop" onClick={() => void engine.cancelRun(r.runId)}><Square size={11} /></button>
                      </div>
                    ))}
                    {working.map((t) => (
                      <button key={t.id} className="home-row home-row-main" onClick={() => app.showTask(t.id)}>
                        <AgentFace seed={t.assignee ?? "task"} size={30} status="running" />
                        <span className="grow" style={{ display: "grid", gap: 1 }}>
                          <span className="title ellipsis">{nameOf(t.assignee)}</span>
                          <span className="sub ellipsis">{t.title}</span>
                        </span>
                      </button>
                    ))}
                  </>
                )}
              </section>

              <section className="card home-card">
                <div className="home-card-head"><h2>Today</h2></div>
                <div className="home-kpis">
                  <div><b className="num">{today ? usd(today.usd) : "$0.00"}</b><small data-tip={today?.source === "estimate" ? "Includes McBot estimates" : "As Hermes priced it"}>Spent{today?.source === "estimate" ? " (est.)" : ""}</small></div>
                  <div><b className="num">{runsToday}</b><small>Runs</small></div>
                  <div><b className="num">{doneToday}</b><small>Tasks done</small></div>
                </div>
              </section>

              <Schedules agents={agents} />

              {agents.length === 0 && (
                <section className="card home-card">
                  <div className="home-empty"><CircleAlert size={14} /> No agents yet <button className="btn sm primary" onClick={() => app.setTeamsOpen(true)}>Start with a team</button><button className="btn sm" onClick={() => app.setNewAgentOpen(true)}><Plus size={12} /> New agent</button></div>
                </section>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
