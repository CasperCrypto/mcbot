import { ArrowUp, Download, Plug, Plus, Square, Waypoints, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentNode, ModelData } from "../../contracts/graph";
import type { RunEvent, RunSummary } from "../../contracts/run";
import { resolveGraph } from "../../compile";
import { runAgent, stopRun } from "../actions";
import { engine } from "../lib/engine";
import { duration, tokens, usd } from "../lib/format";
import { Sidebar } from "../shell/Sidebar";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { AgentFace, Empty } from "../ui";
import { toolLabel } from "../lib/toolLabel";
import { ApprovalCard } from "../approvals/ApprovalCard";
import { RichText } from "../chat/RichText";

function shortTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const day = same(d, today) ? "Today" : same(d, yesterday) ? "Yesterday" : d.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${day} ${shortTime(ts)}`;
}

/** Images and videos a run made: Hermes' image_generate / video_generate results ({ image } / { video }). */
export function madeMedia(events: RunEvent[] | undefined): { kind: "image" | "video"; path: string; seq: number }[] {
  const out: { kind: "image" | "video"; path: string; seq: number }[] = [];
  for (const e of events ?? []) {
    if (e.type !== "run.tool.finished" || e.isError) continue;
    try {
      const r = JSON.parse(e.output) as { success?: boolean; image?: unknown; video?: unknown };
      if (r.success === false) continue;
      // Local files only: a bare provider URL would load from the internet, which the app does not allow.
      for (const kind of ["image", "video"] as const) {
        const p = r[kind];
        if (typeof p === "string" && !/^[a-z]+:\/\//i.test(p)) out.push({ kind, path: p, seq: e.seq });
      }
    } catch {
      // not JSON: not a media result
    }
  }
  return out;
}

/** One made image or video, fetched from the engine (read-only, inside the agent's folder). */
function Made({ profile, kind, path }: { profile: string; kind: "image" | "video"; path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    engine.media(profile, path).then((b) => {
      made = URL.createObjectURL(b);
      if (alive) setUrl(made);
      else URL.revokeObjectURL(made);
    }).catch(() => { if (alive) setFailed(true); });
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [profile, path]);
  const file = path.split(/[\\/]/).pop() ?? "";
  if (failed) return <div className="made missing faint" data-tip={path} data-tip-side="top">{file}</div>;
  if (!url) return <div className="made loading" />;
  return (
    <div className="made" data-testid="made-media">
      {kind === "image" ? <img src={url} alt="" /> : <video src={url} controls />}
      <a className="icon-btn sm made-save" href={url} download={file} aria-label="Save" data-tip="Save" data-tip-side="top"><Download size={13} /></a>
    </div>
  );
}

function AgentMessage({ run, events, name, onChoose }: { run: RunSummary; events: RunEvent[] | undefined; name: string; onChoose?: (reply: string) => void }) {
  const tools = (events ?? []).filter((e): e is Extract<RunEvent, { type: "run.tool.started" }> => e.type === "run.tool.started");
  const failedTools = new Set((events ?? []).filter((e) => e.type === "run.tool.finished" && e.isError).map((e) => (e.type === "run.tool.finished" ? e.tool : "")));
  const text = (run.text || "").trim();
  const failed = run.status === "failed" || run.status === "interrupted";
  const made = madeMedia(events);
  return (
    <div className={`msg agent${failed ? " failed" : ""}`} data-testid="agent-message">
      <div className="from"><AgentFace seed={run.profile} size={18} status={run.status} /><b>{name}</b></div>
      {tools.length > 0 && (
        <div className="steps">
          {tools.map((t) => <span key={t.seq} className={`step-chip${failedTools.has(t.tool) ? " fail" : ""}`} data-tip={t.tool}><Plug size={11} /><span>{toolLabel(t.tool)}</span></span>)}
        </div>
      )}
      <ApprovalCard run={run} />
      {run.status === "running" && !text ? (
        run.approval ? null : <div className="bubble" style={{ padding: 0 }}><span className="typing"><i /><i /><i /></span></div>
      ) : (
        failed && !text ? <div className="bubble" data-testid="agent-text">{run.error ?? "Failed"}</div>
          : <div className="bubble"><RichText text={text} onChoose={run.status === "running" ? undefined : onChoose}
            image={(src, alt) => /^[a-z]+:\/\//i.test(src) ? <span className="faint" data-tip={src}>{alt || "image"}</span> : <Made profile={run.profile} kind="image" path={src} />} /></div>
      )}
      {made.length > 0 && <div className="made-grid">{made.map((m) => <Made key={`${m.seq}-${m.kind}`} profile={run.profile} kind={m.kind} path={m.path} />)}</div>}
      {run.status !== "running" && (
        <div className="meta num">
          {run.finishedAt && <span>{duration(run.finishedAt - run.startedAt)}</span>}
          {run.tokens && <span>{tokens(run.tokens.total)} tokens</span>}
          {(run.reportedUsd || run.estimatedUsd) ? <span>{usd(run.reportedUsd || run.estimatedUsd)}</span> : null}
        </div>
      )}
    </div>
  );
}

function Thread({ agent, model }: { agent: AgentNode; model: string | null }) {
  const { boardId } = useBoard();
  const runs = useApp((s) => s.runs);
  const events = useApp((s) => s.events);
  const loadEvents = useApp((s) => s.loadEvents);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // The box grows with what is typed and shrinks back once it is sent (or cleared).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    if (draft) el.style.height = `${Math.min(200, el.scrollHeight)}px`;
  }, [draft]);
  const name = agent.data.displayName || agent.data.name;

  const thread = useMemo(() => Object.values(runs).filter((r) => r.agentNodeId === agent.id).sort((a, b) => a.startedAt - b.startedAt), [runs, agent.id]);
  const running = thread.find((r) => r.status === "running");
  const textLen = thread.reduce((n, r) => n + r.text.length, 0);
  const asking = thread.filter((r) => r.approval).length;

  useEffect(() => {
    for (const r of thread) if (!events[r.runId]) engine.run(r.runId).then((e) => loadEvents(r.runId, e)).catch(() => undefined);
  }, [thread.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [thread.length, textLen, asking]);

  const queued = useApp((s) => s.queue[agent.id]);
  const send = async () => {
    const prompt = draft.trim();
    if (!prompt) return;
    setDraft("");
    await ask(prompt);
  };
  /** Ask the agent (the composer, or a reply button): straight away, or in the queue while it works. */
  const ask = async (prompt: string) => {
    // Busy, starting, or others are waiting: it goes in the queue and is sent when the agent is free.
    if (running || sending || useApp.getState().starting[agent.id] || queued?.items.length) {
      useApp.getState().enqueue(agent.id, prompt);
      setDraft("");
      return;
    }
    setSending(true);
    setDraft("");
    const id = await runAgent(boardId, agent.id, prompt);
    if (!id) setDraft(prompt);
    setSending(false);
  };

  let lastDay = "";
  return (
    <div className="thread page-enter">
      <div className="thread-head">
        <AgentFace seed={agent.data.name} size={30} status={running ? "running" : thread.at(-1)?.status} />
        <div className="grow">
          <div className="name">{name}</div>
        </div>
        {model && <span className="chip mono">{model}</span>}
      </div>
      <div className="thread-scroll" ref={scroller}>
        <div className="thread-inner" data-testid="thread">
          {thread.length === 0 && (
            <div className="empty" style={{ height: "auto", paddingTop: 80 }}>
              <AgentFace seed={agent.data.name} size={72} />
              <h3>{name}</h3>
              <p>{agent.data.description || "Ask anything."}</p>
            </div>
          )}
          {thread.map((r) => {
            const day = new Date(r.startedAt).toDateString();
            const sep = day !== lastDay ? <div className="day">{dayLabel(r.startedAt)}</div> : null;
            lastDay = day;
            return (
              <div key={r.runId} style={{ display: "grid", gap: 14 }}>
                {sep}
                <div className="msg user"><div className="bubble">{r.prompt}</div></div>
                <AgentMessage run={r} events={events[r.runId]} name={name} onChoose={r === thread.at(-1) ? (reply) => void ask(reply) : undefined} />
              </div>
            );
          })}
        </div>
      </div>
      <div className="composer-wrap">
        {queued && queued.items.length > 0 && (
          <div className="queue" data-testid="queue">
            {queued.items.map((q, i) => (
              <div key={`${i}-${q}`} className="queue-item">
                <span className="queue-n num">{i + 1}</span>
                <span className="grow ellipsis">{q}</span>
                <button className="icon-btn sm" aria-label="Remove from queue" data-tip="Remove" onClick={() => useApp.getState().unqueue(agent.id, i)}><X size={12} /></button>
              </div>
            ))}
            {queued.paused && (
              <div className="queue-paused"><span className="grow">Paused: the first one couldn't start</span>
                <button className="btn sm" onClick={() => useApp.getState().resumeQueue(agent.id)}>Try again</button></div>
            )}
          </div>
        )}
        <div className="composer">
          <textarea rows={1} value={draft} placeholder={running ? `Queue a message for ${name}` : `Message ${name}`} data-testid="composer"
            ref={box} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
          {running && <button className="send stop" aria-label="Stop" data-tip="Stop" onClick={() => void stopRun(running.runId)}><Square size={12} /></button>}
          {(!running || draft.trim()) && <button className="send" aria-label={running ? "Queue" : "Send"} data-tip={running ? "Sends when it's free" : undefined} disabled={!draft.trim()} onClick={send} data-testid="send"><ArrowUp size={16} /></button>}
        </div>
      </div>
    </div>
  );
}

export function AgentsView() {
  const { graph } = useBoard();
  const runs = useApp((s) => s.runs);
  const chatAgentId = useApp((s) => s.chatAgentId);
  const openChat = useApp((s) => s.openChat);
  const setTab = useApp((s) => s.setTab);
  const [q, setQ] = useState("");
  const { bundles } = useMemo(() => resolveGraph(graph), [graph]);
  const agents = graph.nodes.filter((n): n is AgentNode => n.kind === "agent");
  const last = useMemo(() => {
    const m = new Map<string, RunSummary>();
    for (const r of Object.values(runs)) if (!m.get(r.agentNodeId) || m.get(r.agentNodeId)!.startedAt < r.startedAt) m.set(r.agentNodeId, r);
    return m;
  }, [runs]);
  const current = agents.find((a) => a.id === chatAgentId) ?? agents[0] ?? null;
  const modelOf = (id: string) => {
    const m = bundles.find((b) => b.agent.id === id)?.models[0];
    return m ? (m.data as ModelData).model || null : null;
  };
  const shown = agents
    .filter((a) => `${a.data.name} ${a.data.displayName}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (last.get(b.id)?.startedAt ?? 0) - (last.get(a.id)?.startedAt ?? 0));

  return (
    <>
      <Sidebar title="Agents" search={q} onSearch={setQ} testId="agents-sidebar" action={<button className="icon-btn sm" aria-label="New agent" data-tip="New agent" onClick={() => useApp.getState().setNewAgentOpen(true)} data-testid="agents-new"><Plus size={14} /></button>}>
        {shown.map((a) => {
          const r = last.get(a.id);
          const preview = r ? (r.status === "running" ? "Working…" : (r.text || r.error || r.prompt).trim().split("\n")[0]) : a.data.description || "No messages yet";
          return (
            <button key={a.id} className="list-row" aria-selected={current?.id === a.id} onClick={() => openChat(a.id)} style={{ alignItems: "flex-start", padding: "10px" }} data-testid="agent-row">
              <AgentFace seed={a.data.name} size={38} status={r?.status} />
              <span className="grow" style={{ display: "grid", gap: 3 }}>
                <span className="row" style={{ gap: 6 }}>
                  <span className="title ellipsis">{a.data.displayName || a.data.name}</span>
                  <span className="time">{r ? shortTime(r.startedAt) : ""}</span>
                </span>
                <span className="sub ellipsis" style={r?.status === "running" ? { color: "var(--run)" } : undefined}>{preview}</span>
              </span>
            </button>
          );
        })}
      </Sidebar>
      <section className="main">
        {current ? <Thread key={current.id} agent={current} model={modelOf(current.id)} /> : (
          <Empty title="No agents yet" action={<button className="btn light" onClick={() => useApp.getState().setNewAgentOpen(true)}><Plus size={14} /> New agent</button>}>
            Add an agent on the graph, compile, then talk to it here.
          </Empty>
        )}
      </section>
    </>
  );
}
