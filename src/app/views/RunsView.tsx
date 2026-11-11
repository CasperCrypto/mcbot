import { CircleCheck, CircleX, Coins, MessageSquare, Plug, Square, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { RunEvent, RunSummary } from "../../contracts/run";
import { ago, duration, tokens, usd } from "../lib/format";
import { engine } from "../lib/engine";
import { Sidebar } from "../shell/Sidebar";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { AgentFace, Empty } from "../ui";
import { GraphCanvas, type GEdge, type GNode } from "./GraphCanvas";

interface Step {
  id: string;
  kind: "prompt" | "tool" | "answer" | "done" | "cost";
  title: string;
  sub: string;
  state: "" | "ok" | "fail" | "live";
  detail: { label: string; body: string }[];
}

function pretty(v: unknown): string {
  if (typeof v === "string") {
    try {
      return JSON.stringify(JSON.parse(v), null, 2);
    } catch {
      return v;
    }
  }
  return JSON.stringify(v, null, 2) ?? "";
}

function stepsOf(run: RunSummary, events: RunEvent[]): Step[] {
  const out: Step[] = [{ id: "prompt", kind: "prompt", title: "Prompt", sub: run.prompt.split("\n")[0]!.slice(0, 60), state: "", detail: [{ label: "Prompt", body: run.prompt }] }];
  const open = new Map<string, Step>();
  for (const e of events) {
    if (e.type === "run.tool.started") {
      const s: Step = { id: `t${e.seq}`, kind: "tool", title: e.tool, sub: "calling…", state: "live", detail: [{ label: "Input", body: pretty(e.input ?? {}) }] };
      open.set(e.tool, s);
      out.push(s);
    } else if (e.type === "run.tool.finished") {
      const s = open.get(e.tool);
      if (s) {
        s.sub = duration(e.durationMs);
        s.state = e.isError ? "fail" : "ok";
        s.detail.push({ label: e.isError ? "Error" : "Output", body: pretty(e.output) });
        open.delete(e.tool);
      }
    }
  }
  const text = run.text.trim();
  if (text || run.status === "running") out.push({ id: "answer", kind: "answer", title: "Answer", sub: text ? text.split("\n")[0]!.slice(0, 60) : "writing…", state: run.status === "running" ? "live" : "", detail: [{ label: "Answer", body: text }] });
  if (run.status !== "running") {
    out.push({
      id: "done", kind: "done", title: run.status === "succeeded" ? "Finished" : run.status === "interrupted" ? "Stopped" : "Failed",
      sub: [run.finishedAt ? duration(run.finishedAt - run.startedAt) : "", run.tokens ? `${tokens(run.tokens.total)} tokens` : ""].filter(Boolean).join(" · "),
      state: run.status === "succeeded" ? "ok" : "fail",
      detail: [{ label: "Session", body: run.sessionId ?? "—" }, ...(run.error ? [{ label: "Error", body: run.error }] : [])],
    });
  }
  const cost = events.find((e) => e.type === "run.cost");
  if (cost?.type === "run.cost") {
    const reported = cost.costStatus !== "unknown" && cost.reportedUsd !== null;
    out.push({
      id: "cost", kind: "cost", title: reported ? usd(cost.reportedUsd) : cost.estimatedUsd !== null ? `${usd(cost.estimatedUsd)} est.` : "No price",
      sub: `${cost.model ?? "?"} · ${reported ? "reported" : "model pricing"}`, state: "",
      detail: [{ label: "Cost record", body: pretty({ model: cost.model, provider: cost.provider, cost_status: cost.costStatus, estimated_cost_usd: cost.reportedUsd }) }],
    });
  }
  return out;
}

const ICON = { prompt: <MessageSquare size={14} />, tool: <Plug size={14} />, answer: <MessageSquare size={14} />, done: <CircleCheck size={14} />, cost: <Coins size={14} /> };
const TILE = { prompt: "agent", tool: "tool", answer: "agent", done: "file", cost: "file" };

export function RunsView() {
  const { graph } = useBoard();
  const runs = useApp((s) => s.runs);
  const events = useApp((s) => s.events);
  const selectedRunId = useApp((s) => s.selectedRunId);
  const selectRun = useApp((s) => s.selectRun);
  const loadEvents = useApp((s) => s.loadEvents);
  const [step, setStep] = useState<string | null>(null);

  const list = useMemo(() => Object.values(runs).sort((a, b) => b.startedAt - a.startedAt), [runs]);
  const run = (selectedRunId && runs[selectedRunId]) || list[0] || null;
  const evts = run ? events[run.runId] : undefined;
  useEffect(() => {
    if (run && !events[run.runId]) engine.run(run.runId).then((e) => loadEvents(run.runId, e)).catch(() => undefined);
    setStep(null);
  }, [run?.runId]); // eslint-disable-line react-hooks/exhaustive-deps

  const nameOf = (id: string, profile: string) => {
    const n = graph.nodes.find((x) => x.id === id);
    return n?.kind === "agent" ? n.data.displayName || n.data.name : profile;
  };
  const steps = useMemo(() => (run ? stepsOf(run, evts ?? []) : []), [run, evts]);
  const nodes: GNode[] = steps.map((s, i) => ({
    id: s.id, x: 0, y: i * 104, className: s.state,
    content: (
      <>
        <span className={`tile sm ${TILE[s.kind]}`}>{s.kind === "done" && s.state === "fail" ? <CircleX size={14} /> : ICON[s.kind]}</span>
        <span className="grow" style={{ minWidth: 180 }}>
          <span className={`label ellipsis${s.kind === "tool" ? " mono" : ""}`} style={{ display: "block" }}>{s.title}</span>
          <span className="sub ellipsis" style={{ display: "block" }}>{s.sub}</span>
        </span>
        {s.state === "live" && <span className="dot run" />}
      </>
    ),
  }));
  const edges: GEdge[] = steps.slice(1).map((s, i) => ({ id: `e${i}`, source: steps[i]!.id, target: s.id, live: run?.status === "running" }));
  const current = steps.find((s) => s.id === step) ?? null;

  return (
    <>
      <Sidebar title="Activity" testId="runs-sidebar">
        {list.length === 0 && <div className="faint" style={{ padding: "8px 10px" }}>Nothing yet.</div>}
        {list.map((r) => (
          <button key={r.runId} className="list-row" aria-selected={run?.runId === r.runId} onClick={() => selectRun(r.runId)} style={{ alignItems: "flex-start" }} data-testid="run-row">
            <AgentFace seed={r.profile} size={30} status={r.status} />
            <span className="grow" style={{ display: "grid", gap: 2 }}>
              <span className="row" style={{ gap: 6 }}><span className="title ellipsis">{nameOf(r.agentNodeId, r.profile)}</span><span className="time">{ago(r.startedAt)}</span></span>
              <span className="sub ellipsis">{r.prompt}</span>
            </span>
          </button>
        ))}
      </Sidebar>
      <section className="main">
        {!run ? <Empty title="Nothing yet">Every time an agent works, you see each step here: what it was asked, the tools it used, its answer and cost.</Empty> : (
          <div className="view">
            <div className="view-head">
              <AgentFace seed={run.profile} size={26} status={run.status} />
              <h1>{nameOf(run.agentNodeId, run.profile)}</h1>
              <span className={`chip ${run.status === "succeeded" ? "ok" : run.status === "running" ? "run" : "fail"}`}>{run.status}</span>
              <span className="grow" />
              <span className="faint num" style={{ fontSize: 12 }}>
                {[run.finishedAt ? duration(run.finishedAt - run.startedAt) : null, run.tokens ? `${tokens(run.tokens.input)} in · ${tokens(run.tokens.output)} out` : null, run.toolCalls ? `${run.toolCalls} tool call${run.toolCalls > 1 ? "s" : ""}` : null].filter(Boolean).join("  ·  ")}
              </span>
              {run.status === "running" && <button className="btn sm" onClick={() => engine.cancelRun(run.runId)}><Square size={11} /> Stop</button>}
            </div>
            <div style={{ position: "absolute", inset: "52px 0 0 0" }} data-testid="run-graph">
              <div className={`graph-area${current ? " with-panel" : ""}`}><GraphCanvas key={run.runId} nodes={nodes} edges={edges} dir="TB" selected={step} onSelect={setStep} fitSignature={`${run.runId}:${steps.length}:${!!current}`} /></div>
              {current && (
                <aside className="side-panel glass">
                  <div className="side-panel-head"><b className={`grow ellipsis${current.kind === "tool" ? " mono" : ""}`}>{current.title}</b><button className="icon-btn" aria-label="Close" onClick={() => setStep(null)}><X size={15} /></button></div>
                  <div className="side-panel-body stack" style={{ gap: 14 }}>
                    {current.detail.map((d) => (
                      <div key={d.label} className="stack" style={{ gap: 6 }}>
                        <span className="section-label">{d.label}</span>
                        <pre className="code">{d.body || "—"}</pre>
                      </div>
                    ))}
                  </div>
                </aside>
              )}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
