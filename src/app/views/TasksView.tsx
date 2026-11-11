import { ArrowUp, Ban, Check, CircleDashed, GitBranch, MessageSquare, Plus, RotateCcw, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { TaskAction, TaskDetail, TaskStatus, TaskView } from "../../contracts/api";
import type { AgentNode } from "../../contracts/graph";
import { engine } from "../lib/engine";
import { ago } from "../lib/format";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { AgentFace, Empty, PersonFace } from "../ui";

/** Hermes' columns (hermes_cli/kanban_workflow.py); the first three show only when they hold tasks. */
const LANES: { status: TaskStatus; label: string; always: boolean }[] = [
  { status: "triage", label: "Triage", always: false },
  { status: "todo", label: "To do", always: false },
  { status: "scheduled", label: "Scheduled", always: false },
  { status: "ready", label: "Ready", always: true },
  { status: "running", label: "Working", always: true },
  { status: "blocked", label: "Blocked", always: true },
  { status: "review", label: "Review", always: true },
  { status: "done", label: "Done", always: true },
];
const STATE_CHIP: Partial<Record<TaskStatus, string>> = { running: "run", done: "ok", blocked: "fail", review: "warn" };

/** The board's tasks, read again every few seconds while the view is open. */
export function useTasks(boardId: string, every = 3000): { tasks: TaskView[] | null; gateway: boolean; refresh: () => void } {
  const [data, setData] = useState<{ tasks: TaskView[]; gateway: boolean } | null>(null);
  const refresh = useCallback(() => {
    engine.tasks(boardId).then(setData).catch(() => undefined);
  }, [boardId]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, every);
    return () => clearInterval(t);
  }, [refresh, every]);
  return { tasks: data?.tasks ?? null, gateway: data?.gateway ?? false, refresh };
}

function useAgents(): AgentNode[] {
  const { graph } = useBoard();
  return useMemo(() => graph.nodes.filter((n): n is AgentNode => n.kind === "agent"), [graph]);
}

function Who({ name, agents, size = 18 }: { name: string | null; agents: AgentNode[]; size?: number }) {
  const identity = useApp((s) => s.identity);
  if (!name) return <span className="faint">Nobody</span>;
  const agent = agents.find((a) => a.data.name === name);
  return (
    <span className="row" style={{ gap: 6, minWidth: 0 }}>
      {agent ? <AgentFace seed={name} size={size} /> : <PersonFace name={name} color={name === identity.name ? identity.color : "#8e8e93"} size={size} />}
      <span className="ellipsis">{agent ? agent.data.displayName || name : name}</span>
    </span>
  );
}

function Card({ t, agents, selected, onOpen }: { t: TaskView; agents: AgentNode[]; selected: boolean; onOpen: () => void }) {
  return (
    <button className="task-card" aria-selected={selected} onClick={onOpen} data-testid="task-card" data-status={t.status}>
      <span className="task-title">{t.title}</span>
      {t.result && t.status !== "running" && <span className="task-result ellipsis">{t.result}</span>}
      {t.error && t.status === "blocked" && <span className="task-result fail ellipsis">{t.error}</span>}
      <span className="row task-meta">
        {t.assignee ? <AgentFace seed={t.assignee} size={18} status={t.status === "running" ? "running" : null} /> : <CircleDashed size={15} className="faint" />}
        <span className="ellipsis grow">{t.assignee ? agents.find((a) => a.data.name === t.assignee)?.data.displayName || t.assignee : "Nobody yet"}</span>
        {t.parents.length > 0 && <span className="faint" data-tip="Waits for other tasks"><GitBranch size={12} /></span>}
        {t.comments > 0 && <span className="faint row" style={{ gap: 3 }}><MessageSquare size={12} />{t.comments}</span>}
        <span className="faint">{ago(t.createdAt)}</span>
      </span>
    </button>
  );
}

function NewTask({ agents, onClose, onCreated }: { agents: AgentNode[]; onClose: () => void; onCreated: (t: TaskView) => void }) {
  const { boardId } = useBoard();
  const identity = useApp((s) => s.identity);
  const toast = useApp((s) => s.toast);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [assignee, setAssignee] = useState<string | null>(agents[0]?.data.name ?? null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      onCreated(await engine.createTask(boardId, { title: title.trim(), body, assignee, by: identity.name }));
    } catch (err) {
      toast({ kind: "fail", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="side-panel glass" data-testid="task-new">
      <div className="side-panel-head"><b className="grow">New task</b><button className="icon-btn" aria-label="Close" onClick={onClose}><X size={15} /></button></div>
      <div className="side-panel-body stack" style={{ gap: 14 }}>
        <label className="field"><span>Task</span>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Write the launch post" onKeyDown={(e) => { if (e.key === "Enter") void create(); }} data-testid="task-title" />
        </label>
        <label className="field"><span>Details</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder="What done looks like" data-testid="task-body" />
        </label>
        <div className="field"><span>For</span>
          <div className="assignees">
            {agents.map((a) => (
              <button key={a.id} className="assignee" aria-pressed={assignee === a.data.name} onClick={() => setAssignee(a.data.name)}>
                <AgentFace seed={a.data.name} size={22} /><span className="ellipsis">{a.data.displayName || a.data.name}</span>
              </button>
            ))}
            <button className="assignee" aria-pressed={assignee === null} onClick={() => setAssignee(null)} data-tip="Leave it on the board">
              <CircleDashed size={18} /><span>Nobody yet</span>
            </button>
          </div>
        </div>
        <div className="row"><span className="grow" /><button className="btn primary" disabled={!title.trim() || busy} onClick={() => void create()} data-testid="task-create">Add task</button></div>
      </div>
    </aside>
  );
}

function Detail({ id, agents, onClose, onChanged }: { id: string; agents: AgentNode[]; onClose: () => void; onChanged: () => void }) {
  const { boardId } = useBoard();
  const identity = useApp((s) => s.identity);
  const toast = useApp((s) => s.toast);
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => engine.task(boardId, id).then((t) => { if (alive) setTask(t); }).catch(() => undefined);
    void load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [boardId, id]);

  const act = async (a: TaskAction) => {
    setBusy(true);
    try {
      setTask(await engine.actOnTask(boardId, id, identity.name, a));
      if (a.action === "comment" || a.action === "changes") setText("");
      onChanged();
      if (a.action === "archive") onClose();
    } catch (err) {
      toast({ kind: "fail", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!task) return <aside className="side-panel glass"><div className="side-panel-head"><b className="grow">Task</b><button className="icon-btn" aria-label="Close" onClick={onClose}><X size={15} /></button></div></aside>;
  const lane = LANES.find((l) => l.status === task.status);
  return (
    <aside className="side-panel glass" data-testid="task-detail">
      <div className="side-panel-head">
        <b className="grow ellipsis">{task.title}</b>
        <span className={`chip ${STATE_CHIP[task.status] ?? ""}`}>{lane?.label ?? task.status}</span>
        <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={15} /></button>
      </div>
      <div className="side-panel-body stack" style={{ gap: 16 }}>
        {task.body && <p className="task-body">{task.body}</p>}
        <div className="task-facts">
          <span className="faint">For</span>
          <select value={task.assignee ?? ""} disabled={busy || task.status === "running"} onChange={(e) => void act({ action: "assign", profile: e.target.value || null })} aria-label="Assign to">
            <option value="">Nobody yet</option>
            {agents.map((a) => <option key={a.id} value={a.data.name}>{a.data.displayName || a.data.name}</option>)}
          </select>
          <span className="faint">From</span><Who name={task.createdBy} agents={agents} />
          <span className="faint">Added</span><span>{ago(task.createdAt)}</span>
        </div>
        {task.result && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="section-label">Result</span>
            <p className="task-body">{task.result}</p>
          </div>
        )}
        {task.error && <p className="task-body fail">{task.error}</p>}
        <div className="row" style={{ flexWrap: "wrap" }}>
          {task.status === "review" && <button className="btn sm primary" disabled={busy} onClick={() => void act({ action: "complete" })} data-testid="task-approve"><Check size={13} /> Approve</button>}
          {task.status === "review" && <button className="btn sm" disabled={busy || !text.trim()} onClick={() => void act({ action: "changes", text })} data-tip="Write what to change below"><Undo2 size={13} /> Ask for changes</button>}
          {task.status === "blocked" && <button className="btn sm primary" disabled={busy} onClick={() => void act({ action: "unblock" })}><RotateCcw size={13} /> Unblock</button>}
          {["triage", "todo", "ready", "scheduled", "blocked"].includes(task.status) && <button className="btn sm" disabled={busy} onClick={() => void act({ action: "complete" })}><Check size={13} /> Mark done</button>}
          {["triage", "todo", "ready", "scheduled"].includes(task.status) && <button className="btn sm ghost" disabled={busy} onClick={() => void act({ action: "block", text: text.trim() || undefined })}><Ban size={13} /> Block</button>}
          {task.status === "done" && <button className="btn sm ghost" disabled={busy} onClick={() => void act({ action: "archive" })} data-testid="task-archive">Archive</button>}
        </div>
        {(task.thread.length > 0 || task.attempts.length > 0) && (
          <div className="stack" style={{ gap: 10 }}>
            <span className="section-label">Activity</span>
            {[
              ...task.attempts.map((a) => ({ at: a.startedAt, key: `a${a.id}`, node: (
                <div className="task-line" key={`a${a.id}`}>
                  <AgentFace seed={a.profile ?? "agent"} size={18} status={a.status === "running" ? "running" : a.outcome === "completed" ? "succeeded" : a.endedAt ? "failed" : null} />
                  <span className="grow"><b>{agents.find((x) => x.data.name === a.profile)?.data.displayName || a.profile}</b> {a.status === "running" ? "is working on it" : a.outcome === "completed" ? "finished" : a.outcome ?? a.status}{a.error ? `: ${a.error}` : ""}</span>
                  <span className="faint">{ago(a.endedAt ?? a.startedAt)}</span>
                </div>
              ) })),
              ...task.thread.map((c) => ({ at: c.at, key: `c${c.id}`, node: (
                <div className="task-line" key={`c${c.id}`}>
                  <span style={{ paddingTop: 1 }}><Who name={c.author} agents={agents} /></span>
                  <span className="grow task-comment">{c.body}</span>
                  <span className="faint">{ago(c.at)}</span>
                </div>
              ) })),
            ].sort((a, b) => a.at - b.at).map((x) => x.node)}
          </div>
        )}
        <div className="composer task-composer">
          <textarea rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder="Comment" aria-label="Comment"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && text.trim()) { e.preventDefault(); void act({ action: "comment", text }); } }} data-testid="task-comment" />
          <button className="send" aria-label="Send" disabled={!text.trim() || busy} onClick={() => void act({ action: "comment", text })}><ArrowUp size={16} /></button>
        </div>
      </div>
    </aside>
  );
}

export function TasksView() {
  const { boardId } = useBoard();
  const agents = useAgents();
  const { tasks, gateway, refresh } = useTasks(boardId);
  const open = useApp((s) => s.openTask);
  const setOpen = (id: string | null) => useApp.getState().showTask(id, false);

  const lanes = useMemo(() => LANES.map((l) => ({ ...l, tasks: (tasks ?? []).filter((t) => t.status === l.status) })).filter((l) => l.always || l.tasks.length > 0), [tasks]);
  const waiting = (tasks ?? []).some((t) => t.status === "ready" && t.assignee);

  return (
    <section className="main flush-left">
      <div className="view">
        <div className="view-head">
          <h1>Tasks</h1>
          {tasks && <span className="faint num" style={{ fontSize: 12 }}>{tasks.filter((t) => t.status !== "done").length} open</span>}
          {waiting && !gateway && <span className="chip" data-tip="Ready tasks start when the engine's gateway is up">Starting the engine…</span>}
          <span className="grow" />
          <button className="btn sm primary" onClick={() => setOpen("new")} data-testid="task-add"><Plus size={13} /> New task</button>
        </div>
        <div style={{ position: "absolute", inset: "52px 0 0 0" }}>
          {tasks && tasks.length === 0 && open === null ? (
            <Empty title="No tasks yet" action={<button className="btn" onClick={() => setOpen("new")}><Plus size={13} /> New task</button>} />
          ) : (
            <div className={`graph-area${open ? " with-panel" : ""}`}>
              <div className="lanes" data-testid="task-lanes">
                {lanes.map((l) => (
                  <div className="lane" key={l.status} data-status={l.status}>
                    <div className="lane-head"><span>{l.label}</span><span className="faint num">{l.tasks.length || ""}</span></div>
                    <div className="lane-body">
                      {l.tasks.map((t) => <Card key={t.id} t={t} agents={agents} selected={open === t.id} onOpen={() => setOpen(t.id)} />)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {open === "new" && <NewTask agents={agents} onClose={() => setOpen(null)} onCreated={(t) => { refresh(); setOpen(t.id); }} />}
          {open && open !== "new" && <Detail key={open} id={open} agents={agents} onClose={() => setOpen(null)} onChanged={refresh} />}
        </div>
      </div>
    </section>
  );
}
