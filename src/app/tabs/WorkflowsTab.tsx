import { Bot, CircleCheck, CircleX, Coins, Loader, MessageSquare, Plug, Square, Terminal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { RunEvent, RunSummary } from "../../contracts/run";
import { ago, duration, tokens, usd } from "../lib/format";
import { engine } from "../lib/engine";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { Empty } from "../ui";

const statusBadge = (s: RunSummary["status"]) => <span className={`badge ${s === "succeeded" ? "ok" : s === "running" ? "run" : s === "queued" ? "" : "fail"}`}>{s}</span>;

function pretty(v: unknown): string {
  if (typeof v === "string") {
    try {
      return JSON.stringify(JSON.parse(v), null, 2);
    } catch {
      return v;
    }
  }
  return JSON.stringify(v, null, 2);
}

interface Step {
  key: string;
  kind: "start" | "tool" | "answer" | "finish" | "cost";
  events: RunEvent[];
}

/** Fold raw events into timeline steps: tool start+finish pair up, text deltas merge. */
function steps(events: RunEvent[]): Step[] {
  const out: Step[] = [];
  const openTools: Step[] = [];
  let answer: Step | null = null;
  for (const e of events) {
    if (e.type === "run.started") out.push({ key: `s${e.seq}`, kind: "start", events: [e] });
    else if (e.type === "run.tool.started") {
      const s: Step = { key: `t${e.seq}`, kind: "tool", events: [e] };
      openTools.push(s);
      out.push(s);
      answer = null;
    } else if (e.type === "run.tool.finished") {
      const s = openTools.findIndex((t) => t.events[0]?.type === "run.tool.started" && t.events[0].tool === e.tool);
      if (s >= 0) openTools.splice(s, 1)[0]!.events.push(e);
      else out.push({ key: `t${e.seq}`, kind: "tool", events: [e] });
    } else if (e.type === "run.text") {
      if (!answer) out.push((answer = { key: `a${e.seq}`, kind: "answer", events: [] }));
      answer.events.push(e);
    } else if (e.type === "run.finished") out.push({ key: `f${e.seq}`, kind: "finish", events: [e] });
    else if (e.type === "run.cost") out.push({ key: `c${e.seq}`, kind: "cost", events: [e] });
  }
  return out;
}

function StepView({ step }: { step: Step }) {
  const e = step.events[0]!;
  if (step.kind === "start" && e.type === "run.started") {
    return (
      <div className="tl-item"><div className="tl-icon run"><Bot size={12} /></div>
        <div><div className="tl-head"><b>Prompt</b><span className="faint mono" style={{ fontSize: 11 }}>hermes {e.argv.join(" ")}</span></div>
          <div className="tl-body answer">{e.prompt}</div></div></div>
    );
  }
  if (step.kind === "tool") {
    const start = step.events.find((x) => x.type === "run.tool.started");
    const end = step.events.find((x) => x.type === "run.tool.finished");
    const name = start?.type === "run.tool.started" ? start.tool : end?.type === "run.tool.finished" ? end.tool : "tool";
    const failed = end?.type === "run.tool.finished" && end.isError;
    return (
      <div className="tl-item" data-testid="tl-tool"><div className={`tl-icon ${failed ? "fail" : "tool"}`}>{end ? <Plug size={12} /> : <Loader size={12} />}</div>
        <div style={{ minWidth: 0 }}>
          <div className="tl-head"><b className="mono" style={{ fontSize: 12 }}>{name}</b>
            {end?.type === "run.tool.finished" && <span className="faint num">{duration(end.durationMs)}</span>}
            {failed && <span className="badge fail">error</span>}</div>
          <div className="tl-body" style={{ display: "grid", gap: 6 }}>
            {start?.type === "run.tool.started" && start.input !== undefined && <details open={false}><summary className="faint" style={{ fontSize: 12 }}>Input</summary><div className="codeblock">{pretty(start.input)}</div></details>}
            {end?.type === "run.tool.finished" && <details open={failed}><summary className="faint" style={{ fontSize: 12 }}>Output</summary><div className="codeblock">{pretty(end.output)}</div></details>}
          </div></div></div>
    );
  }
  if (step.kind === "answer") {
    return (
      <div className="tl-item"><div className="tl-icon"><MessageSquare size={12} /></div>
        <div><div className="tl-head"><b>Answer</b></div><div className="tl-body answer">{step.events.map((x) => (x.type === "run.text" ? x.text : "")).join("").trim()}</div></div></div>
    );
  }
  if (step.kind === "finish" && e.type === "run.finished") {
    return (
      <div className="tl-item"><div className={`tl-icon ${e.status === "succeeded" ? "ok" : "fail"}`}>{e.status === "succeeded" ? <CircleCheck size={13} /> : <CircleX size={13} />}</div>
        <div><div className="tl-head"><b>{e.status === "succeeded" ? "Finished" : e.status === "interrupted" ? "Interrupted" : "Failed"}</b>
          <span className="faint num">exit {e.exitCode ?? "—"} · {duration(e.durationMs)}{e.tokens ? ` · ${tokens(e.tokens.input)} in / ${tokens(e.tokens.output)} out` : ""}</span></div>
          {e.error && <div className="tl-body codeblock" style={{ color: "var(--fail)" }}>{e.error}</div>}
          {e.sessionId && <div className="faint mono" style={{ fontSize: 11, marginTop: 4 }}>session {e.sessionId}</div>}</div></div>
    );
  }
  if (step.kind === "cost" && e.type === "run.cost") {
    return (
      <div className="tl-item"><div className="tl-icon"><Coins size={12} /></div>
        <div><div className="tl-head"><b>Cost</b>
          <span className="faint">{e.costStatus !== "unknown" && e.reportedUsd !== null ? `${usd(e.reportedUsd)} reported by Hermes` : e.estimatedUsd !== null ? `${usd(e.estimatedUsd)} estimated from model pricing` : "Hermes has no price for this endpoint"}</span></div>
          <div className="faint mono" style={{ fontSize: 11 }}>{e.model} · {e.provider} · cost_status {e.costStatus}</div></div></div>
    );
  }
  return null;
}

export function WorkflowsTab() {
  const { boardId, graph } = useBoard();
  const runs = useApp((s) => s.runs);
  const events = useApp((s) => s.events);
  const selectedRunId = useApp((s) => s.selectedRunId);
  const selectRun = useApp((s) => s.selectRun);
  const loadEvents = useApp((s) => s.loadEvents);
  const [showLogs, setShowLogs] = useState(false);

  const list = useMemo(() => Object.values(runs).sort((a, b) => b.startedAt - a.startedAt), [runs]);
  const current = (selectedRunId && runs[selectedRunId]) || list[0] || null;
  const evts = current ? events[current.runId] : undefined;

  useEffect(() => {
    if (current && !events[current.runId]) engine.run(current.runId).then((e) => loadEvents(current.runId, e)).catch(() => undefined);
  }, [current?.runId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!list.length) {
    return <div className="page"><Empty icon={<Terminal size={28} />} title="No runs yet">Select an agent on the graph, compile, then run it. Every run gets a timeline here: each step, its inputs and outputs, cost and failures.</Empty></div>;
  }

  const agentName = (id: string) => {
    const n = graph.nodes.find((x) => x.id === id);
    return n?.kind === "agent" ? n.data.displayName || n.data.name : "removed agent";
  };
  const logs = (evts ?? []).filter((e): e is Extract<RunEvent, { type: "run.log" }> => e.type === "run.log");

  return (
    <div className="split">
      <div className="list" role="listbox" aria-label="Runs">
        {list.map((r) => (
          <div key={r.runId} role="option" className="run-row" aria-selected={current?.runId === r.runId} onClick={() => selectRun(r.runId)} data-testid="run-row">
            <div className="top">{statusBadge(r.status)}<b className="ellipsis" style={{ flex: 1 }}>{agentName(r.agentNodeId)}</b><span className="faint" style={{ fontSize: 11 }}>{ago(r.startedAt)}</span></div>
            <div className="prompt">{r.prompt}</div>
            <div className="faint num" style={{ fontSize: 11 }}>{r.toolCalls} tool call{r.toolCalls === 1 ? "" : "s"}{r.tokens ? ` · ${tokens(r.tokens.total)} tokens` : ""}{r.finishedAt ? ` · ${duration(r.finishedAt - r.startedAt)}` : ""}</div>
          </div>
        ))}
      </div>
      <div className="detail">
        {current && (
          <>
            <div className="row" style={{ marginBottom: 14 }}>
              <h2 style={{ margin: 0, font: "600 17px/1.3 var(--font-display)" }}>{agentName(current.agentNodeId)}</h2>
              {statusBadge(current.status)}
              <span style={{ flex: 1 }} />
              {current.status === "running" && <button className="btn" onClick={() => engine.cancelRun(current.runId)}><Square size={12} /> Stop</button>}
            </div>
            <div className="stats">
              <div className="stat"><small>Duration</small><b>{current.finishedAt ? duration(current.finishedAt - current.startedAt) : "running"}</b></div>
              <div className="stat"><small>Tokens in / out</small><b>{current.tokens ? `${tokens(current.tokens.input)} / ${tokens(current.tokens.output)}` : "—"}</b></div>
              <div className="stat"><small>Tool calls</small><b>{current.toolCalls}{current.toolErrors ? <span style={{ color: "var(--fail)" }}> · {current.toolErrors} failed</span> : null}</b></div>
              <div className="stat"><small>Cost</small><b>{current.reportedUsd ? usd(current.reportedUsd) : current.estimatedUsd !== null ? `${usd(current.estimatedUsd)} est.` : "—"}</b></div>
              <div className="stat"><small>Profile</small><b className="mono" style={{ fontSize: 13 }}>{current.profile}</b></div>
            </div>
            <div className="timeline" data-testid="timeline">{steps(evts ?? []).map((s) => <StepView key={s.key} step={s} />)}</div>
            {logs.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <button className="btn ghost sm" onClick={() => setShowLogs(!showLogs)}><Terminal size={12} /> {showLogs ? "Hide" : "Show"} process log ({logs.length} lines)</button>
                {showLogs && <div className="codeblock" style={{ marginTop: 8, maxHeight: 360 }}>{logs.map((l) => l.line).join("\n")}</div>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
