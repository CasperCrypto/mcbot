import { ArrowUp, Bell, CalendarClock, Check, ChevronDown, ChevronRight, CircleDashed, Clock, Cpu, Hammer, History, KeyRound, ListChecks, Pause, Play, Plus, RotateCcw, SlidersHorizontal, Square, Trash2, Wallet, X, StickyNote as StickyNoteIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AgentSchedules, CostReport, TaskView } from "../../contracts/api";
import type { AgentNode } from "../../contracts/graph";
import type { RunEvent, RunSummary } from "../../contracts/run";
import { compileBoard, openHermesSetup, runAgent, stopRun } from "../actions";
import { engine, onKeysChanged } from "../lib/engine";
import { ago, usd } from "../lib/format";
import { dailySeries, utcDay } from "../lib/series";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { AgentFace, Segmented } from "../ui";
import { NOTE_COLORS, type Note } from "../../contracts/graph";
import { addNote } from "../../board/ydoc";
import { newId } from "../graph/defaults";
import { StickyNote } from "../notes/StickyNote";
import { useTasks } from "./TasksView";
import { ApprovalCard } from "../approvals/ApprovalCard";
import { agentsWithoutModel, chainOf, modelsOf } from "../lib/models";
import { useModelHealth } from "../lib/useModelHealth";
import { nameChosen } from "../lib/identity";
import { latestRunByAgent } from "../state/store";
import { REMOTE } from "../lib/engine";

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
  if (agents.length === 0 || !chosen) return null;
  const who = chosen.data.displayName || chosen.data.name;
  return (
    <div className="composer dash-ask" data-testid="home-ask">
      <label className="ask-who" data-tip="Who to ask">
        <AgentFace seed={chosen.data.name} size={22} />
        <select value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="Agent" data-testid="home-ask-agent">
          {agents.map((a) => <option key={a.id} value={a.id}>{a.data.displayName || a.data.name}</option>)}
        </select>
        <ChevronDown size={12} />
      </label>
      <textarea rows={1} value={text} onChange={(e) => setText(e.target.value)} data-testid="home-ask-input"
        placeholder={mode === "ask" ? `Ask ${who} anything…` : `Give ${who} a task…`}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
      <div className="ask-mode"><Segmented value={mode} onChange={setMode} options={[{ value: "ask", label: "Ask" }, { value: "task", label: "Task" }]} /></div>
      <button className="send" aria-label="Send" disabled={!text.trim() || busy} onClick={() => void send()}><ArrowUp size={16} /></button>
    </div>
  );
}

/** One agent as a tile, the way a home app shows a room's lights: who, and what it is doing now. */
function AgentTile({ agent, live, runId, step, failed, asks, noModel, last }: { agent: AgentNode; live: boolean; runId: string | null; step: string; failed: boolean; asks: boolean; noModel: boolean; last: number | null }) {
  const name = agent.data.displayName || agent.data.name;
  const state = asks ? "warn" : live ? "run" : noModel ? "warn" : failed ? "fail" : "idle";
  const line = asks ? "Asks before acting" : live ? step : noModel ? "No model yet" : failed ? "Last run failed" : last ? `Free · ${ago(last)}` : agent.data.description || "Free";
  const app = useApp.getState();
  return (
    <div className="agent-tile" data-state={state} data-testid="home-agent">
      <button className="agent-tile-main" onClick={() => app.openChat(agent.id)} data-tip="Chat">
        <AgentFace seed={agent.data.name} size={34} status={live ? "running" : failed ? "failed" : undefined} />
        <span className="t"><b>{name}</b><small>{line}</small></span>
      </button>
      {runId
        ? <button className="agent-tile-edit shown" aria-label={`Stop ${name}`} data-tip="Stop" onClick={() => void stopRun(runId)}><Square size={10} /></button>
        : <button className="agent-tile-edit" aria-label={`${name}: settings`} data-tip="Settings" onClick={() => app.editAgent(agent.id)}><SlidersHorizontal size={13} /></button>}
    </div>
  );
}

/** Today's spend, big, over the last seven days as small bars (UTC days, as Cost counts them). */
function SpendWidget({ cost }: { cost: CostReport | null }) {
  const now = Date.now();
  const days = dailySeries(cost?.byDay ?? [], now, 7, 7);
  const today = days.at(-1);
  const week = days.reduce((n, d) => n + d.usd, 0);
  const max = Math.max(...days.map((d) => d.usd), 0.000001);
  const over = (cost?.budgets ?? []).filter((b) => b.state !== "ok").length;
  return (
    <button className="widget spend-widget" onClick={() => useApp.getState().setTab("cost")} data-testid="home-spend">
      <div className="widget-head"><Wallet size={13} /><h2>Spent today</h2></div>
      <b className="spend-now num">{usd(today?.usd ?? 0)}</b>
      <div className="spend-bars" aria-hidden>
        {days.map((d) => <i key={d.key} data-today={d.key === utcDay(now) || undefined} style={{ height: `${d.usd > 0 ? Math.max(8, (d.usd / max) * 100) : 4}%` }} />)}
      </div>
      <small className="widget-foot">{usd(week)} this week{today?.source === "estimate" ? " · est." : ""}{over ? ` · ${over} near budget` : ""}</small>
    </button>
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
    <section className="widget" data-testid="home-schedules">
      <div className="widget-head">
        <CalendarClock size={13} /><h2>Up next</h2><span className="grow" />
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
      {jobs.length === 0 && !adding ? <div className="home-empty">Nothing scheduled</div> : jobs.map((j) => (
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

const STARTED = "mcbot.getting-started.hidden";
const hiddenStart = (): boolean => {
  try {
    return localStorage.getItem(STARTED) === "1";
  } catch {
    return false;
  }
};

/** First steps, in order, each with the one action that does it. Hides when done or dismissed. */
function GettingStarted({ agents, keys, runs, silent }: { agents: AgentNode[]; keys: string[] | null; runs: number; silent: number }) {
  const { boardId, graph } = useBoard();
  const drift = useApp((s) => s.drift);
  const health = useApp((s) => s.health);
  const app = useApp.getState();
  const [hidden, setHidden] = useState(hiddenStart);
  const [all, setAll] = useState(false);
  const identity = useApp((s) => s.identity);
  const noModel = agentsWithoutModel(graph);
  const missingKeys = modelsOf(graph).filter((m) => m.data.endpoint === "cloud" && m.data.apiKeyEnv && keys && !keys.includes(m.data.apiKeyEnv));
  const steps = [
    { id: "agents", label: "Add your agents", done: agents.length > 0, action: { label: "Pick a team", run: () => app.setTeamsOpen(true) } },
    { id: "model", label: "Give them a model", sub: noModel.length ? `${noModel.length} without one` : missingKeys.length ? "A key is missing" : silent ? "Its server isn't answering" : undefined, done: agents.length > 0 && noModel.length === 0 && missingKeys.length === 0 && silent === 0, action: { label: "Add model", run: () => app.openSettings(missingKeys.length && !noModel.length ? "keys" : "models") } },
    { id: "engine", label: "Prepare the engine", done: !!health?.hermes.found, action: { label: "Prepare", run: () => app.openSettings("engine") } },
    { id: "compile", label: "Compile", sub: "Writes the agents to disk", done: agents.length > 0 && drift === 0, action: { label: "Compile", run: () => void compileBoard(boardId) } },
    { id: "ask", label: "Ask an agent something", done: runs > 0, action: { label: "Ask", run: () => agents[0] && app.openChat(agents[0].id) } },
    ...(nameChosen(identity) ? [] : [{ id: "name", label: "Add your name", sub: "Teammates see it", done: false, action: { label: "Add", run: () => app.openSettings("you") } }]),
    ...(REMOTE ? [] : [{ id: "invite", label: "Invite a teammate", sub: "Optional", done: false, action: { label: "Invite", run: () => app.setShareOpen(true) } }]),
  ];
  const required = steps.filter((s) => s.id !== "invite" && s.id !== "name");
  if (hidden || required.every((s) => s.done)) return null;
  const next = steps.find((s) => !s.done);
  const done = steps.filter((s) => s.done).length;
  return (
    <section className="widget start-card" data-testid="getting-started">
      <div className="widget-head">
        <h2>Get started</h2>
        <span className="start-progress" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label={`${done} of ${steps.length} done`}><i style={{ width: `${(done / steps.length) * 100}%` }} /></span>
        <span className="faint num" style={{ fontSize: 12 }}>{done} of {steps.length}</span><span className="grow" />
        <button className="icon-btn sm" aria-label="Hide" data-tip="Hide" onClick={() => { try { localStorage.setItem(STARTED, "1"); } catch { /* this session */ } setHidden(true); }}><X size={13} /></button>
      </div>
      <ol className="start-steps">
        {steps.filter((s) => all || s === next).map((s) => (
          <li key={s.id} data-done={s.done || undefined} data-next={s === next || undefined}>
            <span className="start-mark">{s.done ? <Check size={12} strokeWidth={3} /> : null}</span>
            <span className="grow"><span className="title">{s.label}</span>{s.sub && !s.done && <span className="sub"> · {s.sub}</span>}</span>
            {!s.done && <button className={`btn sm${s === next ? " primary" : " ghost"}`} onClick={s.action.run} data-testid={`start-${s.id}`}>{s.action.label}</button>}
          </li>
        ))}
      </ol>
      <button className="btn ghost sm start-all" onClick={() => setAll(!all)} aria-expanded={all} data-testid="start-all">{all ? "Fewer" : `All ${steps.length} steps`}</button>
    </section>
  );
}

/** Pin a note for the team: on Home and on the board (left of everything, never over an agent). */
function useAddNote(): () => void {
  const { doc, graph } = useBoard();
  const identity = useApp((s) => s.identity);
  return () => {
    const left = Math.min(0, ...graph.nodes.map((n) => n.position.x)) - 300;
    const fromHome = (graph.notes ?? []).filter((n) => n.position.x === left).length;
    const note: Note = { id: newId("note"), text: "", color: NOTE_COLORS[(graph.notes?.length ?? 0) % 4]!, position: { x: Math.round(left), y: fromHome * 200 }, pinned: true, author: identity.name, at: Date.now() };
    addNote(doc, note);
    useApp.getState().setFreshNote(note.id);
  };
}

/** The board's pinned sticky notes (none: nothing shown). */
function Notes() {
  const { graph } = useBoard();
  const pinned = (graph.notes ?? []).filter((n) => n.pinned).sort((a, b) => b.at - a.at);
  if (!pinned.length) return null;
  return (
    <section className="notes-grid" data-testid="home-notes" aria-label="Notes">
      {pinned.map((n) => <StickyNote key={n.id} note={n} />)}
    </section>
  );
}

export function HomeView() {
  const { boardId, graph } = useBoard();
  const addNoteNow = useAddNote();
  const identity = useApp((s) => s.identity);
  const runs = useApp((s) => s.runs);
  const events = useApp((s) => s.events);
  const drift = useApp((s) => s.drift);
  const { tasks } = useTasks(boardId, 4000);
  const [cost, setCost] = useState<CostReport | null>(null);
  const [keys, setKeys] = useState<string[] | null>(null);
  const health = useApp((s) => s.health);
  const agents = useMemo(() => graph.nodes.filter((n): n is AgentNode => n.kind === "agent"), [graph]);
  const nameOf = (profile: string | null) => {
    const a = agents.find((x) => x.data.name === profile);
    return a ? a.data.displayName || a.data.name : profile ?? "Nobody";
  };
  const finished = Object.values(runs).filter((r) => r.status !== "running").length;
  useEffect(() => {
    engine.cost(boardId).then(setCost).catch(() => undefined);
  }, [boardId, finished]);
  const [keysRev, setKeysRev] = useState(0);
  useEffect(() => {
    return onKeysChanged(() => setKeysRev((n) => n + 1));
  }, []);
  useEffect(() => {
    engine.secrets().then((r) => setKeys(r.names)).catch(() => setKeys(null));
  }, [boardId, graph, keysRev]);
  const noModel = agentsWithoutModel(graph);
  const modelHealth = useModelHealth(modelsOf(graph));
  const silent = modelsOf(graph).filter((m) => modelHealth[m.id] === "down" || modelHealth[m.id] === "missing");
  const missingKeys = [...new Set(modelsOf(graph).filter((m) => m.data.endpoint === "cloud" && m.data.apiKeyEnv && keys && !keys.includes(m.data.apiKeyEnv)).map((m) => m.data.apiKeyEnv))];

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
    ...(health && !health.hermes.found && !REMOTE ? [{
      key: "engine", at: Date.now(), face: <span className="tile sm agent"><Cpu size={14} /></span>, title: "The engine isn't ready", sub: "Prepare it once so agents can run", tone: "warn" as const,
      action: { label: "Prepare", icon: <Cpu size={12} />, run: () => app.openSettings("engine") }, open: () => app.openSettings("engine"),
    }] : []),
    ...(noModel.length ? [{
      key: "no-model", at: Date.now(), face: <span className="tile sm model"><Cpu size={14} /></span>,
      title: `${noModel.map((a) => a.data.displayName || a.data.name).slice(0, 3).join(", ")}${noModel.length > 3 ? ` and ${noModel.length - 3} more` : ""} ${noModel.length > 1 ? "have" : "has"} no model`, sub: "Agents need a model to think with", tone: "warn" as const,
      action: { label: "Add model", icon: <Plus size={12} />, run: () => app.openSettings("models") }, open: () => app.openSettings("models"),
    }] : []),
    ...silent.map((m): Item => ({
      key: `model-${m.id}`, at: Date.now(), face: <span className="tile sm model"><Cpu size={14} /></span>,
      title: modelHealth[m.id] === "down" ? `${m.data.label || m.data.name} isn't running` : `${m.data.label || m.data.name} doesn't have ${m.data.model}`,
      sub: modelHealth[m.id] === "down" ? `Nothing answers at ${m.data.baseUrl}` : "Pull the model, or pick one it has", tone: "warn",
      action: { label: "Fix", icon: <Cpu size={12} />, run: () => app.openSettings("models") }, open: () => app.openSettings("models"),
    })),
    ...missingKeys.map((k): Item => ({
      key: `key-${k}`, at: Date.now(), face: <span className="tile sm file"><KeyRound size={14} /></span>, title: `${k} isn't saved`, sub: "A cloud model needs this key", tone: "warn",
      action: { label: "Add key", icon: <KeyRound size={12} />, run: () => app.openSettings("keys") }, open: () => app.openSettings("keys"),
    })),
    ...(drift ? [{
      key: "compile", at: Date.now(), face: <span className="tile sm agent"><Hammer size={14} /></span>, title: `${drift} file${drift > 1 ? "s" : ""} differ from the board`, sub: "Agents run what was last compiled", tone: "warn" as const,
      action: { label: "Compile", icon: <Hammer size={12} />, run: () => void compileBoard(boardId) }, open: () => app.setTab("graph"),
    }] : []),
    ...(cost?.budgets ?? []).filter((b) => b.state !== "ok").map((b): Item => ({
      key: `budget-${b.profile}`, at: Date.now(), face: <AgentFace seed={b.profile} size={30} status={b.state === "over" ? "failed" : undefined} />,
      title: `${nameOf(b.profile)} ${b.state === "over" ? "is over" : "is close to"} its daily budget`, sub: `${usd(b.spentTodayUsd)} of ${usd(b.limitUsd)} today`, tone: b.state === "over" ? "fail" : "warn",
      action: { label: "Cost", icon: <Clock size={12} />, run: () => app.setTab("cost") }, open: () => app.setTab("cost"),
    })),
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

  const today = cost?.byDay.find((d) => d.key === utcDay(Date.now()));
  const runsToday = list.filter((r) => r.startedAt > new Date().setHours(0, 0, 0, 0)).length;
  const doneToday = (tasks ?? []).filter((t) => t.status === "done" && (t.completedAt ?? 0) > new Date().setHours(0, 0, 0, 0)).length;
  const asking = list.filter((r) => r.approval);
  const needs = inbox.length + asking.length;
  const latest = latestRunByAgent(runs);
  const busyTask = (profile: string) => working.find((t) => t.assignee === profile);
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <section className="main flush-left">
      <div className="scroll-page home" data-testid="home">
        <div className="home-inner dash">
          <header className="dash-head" data-testid="home-hello">
            <div className="dash-title">
              <span className="dash-date">{new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</span>
              <h1>Home</h1>
            </div>
            <span className="grow" />
            <button className="btn sm ghost" onClick={addNoteNow} data-testid="note-add" data-tip="Pin a note for the team"><StickyNoteIcon size={13} /> Note</button>
            <button className="btn sm" onClick={() => app.setNewAgentOpen(true)} data-testid="home-new-agent"><Plus size={13} /> Agent</button>
          </header>

          <div className="dash-pills" data-testid="home-today">
            {live.length + working.length > 0 && <button className="dash-pill" data-tone="run" onClick={() => go("home-agents")}><i />{live.length + working.length} at work</button>}
            {needs > 0 && <button className="dash-pill" data-tone="warn" onClick={() => go("home-inbox")}><Bell size={12} />{needs} need{needs === 1 ? "s" : ""} you</button>}
            <button className="dash-pill" onClick={() => app.setTab("cost")} data-tip={today?.source === "estimate" ? "Includes McBot estimates" : "As Hermes priced it"}><b className="num">{today ? usd(today.usd) : "$0.00"}</b> today</button>
            <button className="dash-pill" onClick={() => app.setTab("workflows")}><b className="num">{runsToday}</b> run{runsToday === 1 ? "" : "s"}</button>
            <button className="dash-pill" onClick={() => app.setTab("tasks")}><b className="num">{doneToday}</b> done</button>
          </div>

          {agents.length === 0 ? (
            // An empty board: the first thing to do is the only thing shown big.
            <section className="widget home-start" data-testid="home-start">
              <h2>Start this board</h2>
              <span className="faint">Pick a ready team, make one agent, or bring the agents you already run in Hermes.</span>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button className="btn primary" onClick={() => app.setTeamsOpen(true)}>Start with a team</button>
                <button className="btn" onClick={() => app.setNewAgentOpen(true)}><Plus size={13} /> New agent</button>
                <button className="btn ghost" onClick={() => void openHermesSetup()}>Open my Hermes setup</button>
              </div>
            </section>
          ) : <Ask agents={agents} />}

          {agents.length > 0 && (
            <section className="dash-section" id="home-agents" data-testid="home-live">
              <div className="dash-section-head"><h2>Agents</h2><span className="grow" /><button className="btn ghost sm" onClick={() => app.setTab("graph")}>Board <ChevronRight size={12} /></button></div>
              <div className="agent-tiles">
                {agents.map((a) => {
                  const r = latest.get(a.id);
                  const run = live.find((x) => x.agentNodeId === a.id);
                  const task = busyTask(a.data.name);
                  return (
                    <AgentTile key={a.id} agent={a} live={!!run || !!task} runId={run?.runId ?? null} step={run ? stepOf(events[run.runId]) : task ? task.title : ""}
                      failed={r?.status === "failed"} asks={!!r?.approval} noModel={chainOf(graph, a.id).length === 0} last={r ? r.finishedAt ?? r.startedAt : null} />
                  );
                })}
                <button className="agent-tile add" onClick={() => app.setNewAgentOpen(true)} data-testid="home-tile-new"><Plus size={16} /><span>New agent</span></button>
              </div>
            </section>
          )}

          {agents.length > 0 && <GettingStarted agents={agents} keys={keys} runs={list.length} silent={silent.length} />}
          <Notes />

          <div className="dash-grid">
            <section className="widget wide" id="home-inbox" data-testid="home-inbox">
              <div className="widget-head"><Bell size={13} /><h2>Needs you</h2>{needs > 0 && <span className="chip warn num">{needs}</span>}</div>
              {asking.map((r) => (
                <div key={`ask-${r.runId}`} className="home-ask-row" data-testid="home-approval">
                  <div className="row" style={{ gap: 8, padding: "2px 2px 6px" }}>
                    <AgentFace seed={r.profile} size={22} status="running" />
                    <span className="title ellipsis grow">{nameOf(r.profile)} asks before acting</span>
                    <button className="btn sm ghost" onClick={() => app.openChat(r.agentNodeId)}>Open chat</button>
                  </div>
                  <ApprovalCard run={r} compact />
                </div>
              ))}
              {needs === 0 ? <div className="home-empty widget-calm"><Check size={14} /> Nothing waiting on you</div> : inbox.map((i) => (
                <div key={i.key} className="home-row need-row" data-tone={i.tone}>
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

            <SpendWidget cost={cost} />

            <section className="widget wide" data-testid="home-recent">
              <div className="widget-head"><History size={13} /><h2>Lately</h2></div>
              {recent.length === 0 ? <div className="home-empty">Answers and finished tasks show up here</div> : recent.map((r) => (
                <button key={r.key} className="home-row home-row-main" onClick={r.open}>
                  <AgentFace seed={r.profile} size={28} status="succeeded" />
                  <span className="grow" style={{ display: "grid", gap: 1 }}>
                    <span className="title ellipsis">{r.title}</span>
                    <span className="sub ellipsis">{r.sub}</span>
                  </span>
                  <span className="faint" style={{ fontSize: 12 }}>{ago(r.at)}</span>
                </button>
              ))}
            </section>

            <Schedules agents={agents} />
          </div>
        </div>
      </div>
    </section>
  );
}
