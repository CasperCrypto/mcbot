import { ArrowUp, Cloud, HardDrive, MessagesSquare, Plug, Plus, Square, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { removeNodes, setNodeField, updateEdge } from "../../board/ydoc";
import type { Issue } from "../../compile";
import { AgentDataSchema, ModelDataSchema, ToolDataSchema, type AgentData, type GraphNode, type ModelData, type Skill, type ToolData } from "../../contracts/graph";
import { runAgent } from "../actions";
import { engine } from "../lib/engine";
import { duration, tokens as fmtTokens, usd } from "../lib/format";
import { useBoard } from "../state/board";
import { latestRunByAgent, useApp } from "../state/store";
import { AgentFace, Field, Issues, Segmented, TextListField } from "../ui";

type Errors = Record<string, string>;
function fieldErrors(schema: { safeParse(v: unknown): { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } } }, data: unknown): Errors {
  const r = schema.safeParse(data);
  if (r.success || !r.error) return {};
  const out: Errors = {};
  for (const i of r.error.issues) out[i.path.map(String).join(".")] ??= i.message;
  return out;
}

export function Inspector({ node, issues }: { node: GraphNode; issues: Issue[] }) {
  const { doc } = useBoard();
  const select = useApp((s) => s.select);
  const runs = useApp((s) => s.runs);
  const set = (field: string, value: unknown) => setNodeField(doc, node.id, field, value);
  const status = node.kind === "agent" ? latestRunByAgent(runs).get(node.id)?.status : undefined;

  const titleField = node.kind === "agent" ? "displayName" : "label";
  const title = node.kind === "agent" ? (node.data as AgentData).displayName : (node.data as ModelData | ToolData).label;
  const sub = node.kind === "agent" ? `hermes -p ${node.data.name || "…"}`
    : node.kind === "model" ? ((node.data as ModelData).endpoint === "local" ? "Local model" : "Cloud model") : "MCP server";

  return (
    <aside className="inspector glass" aria-label="Inspector" data-testid="inspector">
      <div className="inspector-head">
        {node.kind === "agent" ? <AgentFace seed={node.data.name} size={42} status={status} />
          : <span className={`tile ${node.kind === "tool" ? "tool" : (node.data as ModelData).endpoint === "local" ? "model" : "cloud"}`}>
            {node.kind === "tool" ? <Plug size={16} /> : (node.data as ModelData).endpoint === "local" ? <HardDrive size={16} /> : <Cloud size={16} />}
          </span>}
        <div className="title">
          <input value={title} placeholder={node.data.name || "Untitled"} onChange={(e) => set(titleField, e.target.value)} aria-label="Name" data-testid="inspector-title" />
          <small className={node.kind === "agent" ? "mono" : undefined}>{sub}</small>
        </div>
        <button className="icon-btn" data-tip="Delete" data-tip-side="bottom" aria-label="Delete" onClick={() => { removeNodes(doc, [node.id]); select(null); }}><Trash2 size={15} /></button>
        <button className="icon-btn" aria-label="Close" onClick={() => select(null)}><X size={16} /></button>
      </div>
      {node.kind === "agent" ? <AgentPanel node={node} set={set} issues={issues} /> : (
        <div className="inspector-body">
          <Issues issues={issues} />
          {node.kind === "model" && <ModelFields data={node.data} set={set} />}
          {node.kind === "tool" && <ToolFields data={node.data} set={set} />}
        </div>
      )}
    </aside>
  );
}

type AgentTab = "setup" | "skills" | "run";

function AgentPanel({ node, set, issues }: { node: Extract<GraphNode, { kind: "agent" }>; set: (f: string, v: unknown) => void; issues: Issue[] }) {
  const [tab, setTab] = useState<AgentTab>("setup");
  return (
    <>
      <div className="inspector-tabs">
        <Segmented value={tab} onChange={setTab} options={[{ value: "setup", label: "Setup" }, { value: "skills", label: `Skills${node.data.skills.length ? ` ${node.data.skills.length}` : ""}` }, { value: "run", label: "Run" }]} />
      </div>
      <div className="inspector-body">
        <Issues issues={issues} />
        {tab === "setup" && <AgentSetup node={node} set={set} />}
        {tab === "skills" && <Skills data={node.data} set={set} />}
        {tab === "run" && <RunBox agentNodeId={node.id} profile={node.data.name} />}
      </div>
    </>
  );
}

function AgentSetup({ node, set }: { node: Extract<GraphNode, { kind: "agent" }>; set: (f: string, v: unknown) => void }) {
  const a = node.data;
  const errors = fieldErrors(AgentDataSchema, a);
  const { graph, doc } = useBoard();
  const linked = graph.edges
    .filter((e) => e.source === node.id || e.target === node.id)
    .map((e) => ({ edge: e, other: graph.nodes.find((n) => n.id === (e.source === node.id ? e.target : e.source)) }))
    .filter((x): x is { edge: typeof x.edge; other: GraphNode } => !!x.other);
  const chain = linked.filter((x) => x.other.kind === "model").sort((x, y) => x.edge.order - y.edge.order || (x.edge.id < y.edge.id ? -1 : 1));
  const tools = linked.filter((x) => x.other.kind === "tool");
  const makePrimary = (edgeId: string) => {
    const ordered = [chain.find((c) => c.edge.id === edgeId)!, ...chain.filter((c) => c.edge.id !== edgeId)];
    doc.transact(() => ordered.forEach((c, i) => updateEdge(doc, c.edge.id, { order: i })));
  };

  return (
    <>
      <Field label="Profile" value={a.name} onChange={(v) => set("name", v)} mono error={errors.name} testId="agent-name" />
      <Field label="Description" value={a.description} onChange={(v) => set("description", v)} multiline rows={2} />
      <Field label="Soul" value={a.soul} onChange={(v) => set("soul", v)} multiline rows={7} mono placeholder={"Who this agent is.\nHow it speaks. What it avoids."} />
      <div className="stack">
        <span className="section-label">Models</span>
        {chain.length === 0 ? <span className="faint">Connect a model to this agent.</span> : (
          <div className="chain">
            {chain.map((c, i) => (
              <div key={c.edge.id} className="chain-item">
                <span className={`chip ${i === 0 ? "accent" : ""}`}>{i === 0 ? "Primary" : `Fallback ${i}`}</span>
                <span className="mono grow ellipsis">{(c.other.data as ModelData).model || c.other.data.name}</span>
                {i > 0 && <button className="icon-btn sm" aria-label="Make primary" data-tip="Make primary" data-tip-side="top" onClick={() => makePrimary(c.edge.id)}><ArrowUp size={13} /></button>}
              </div>
            ))}
          </div>
        )}
      </div>
      {tools.length > 0 && (
        <div className="stack">
          <span className="section-label">Tools</span>
          <div className="chain">
            {tools.map((t) => (
              <div key={t.edge.id} className="chain-item"><Plug size={13} className="faint" /><span className="grow ellipsis">{(t.other.data as ToolData).label || t.other.data.name}</span><span className="chip mono">{t.other.data.name}</span></div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function Skills({ data, set }: { data: AgentData; set: (f: string, v: unknown) => void }) {
  const errors = fieldErrors(AgentDataSchema, data);
  const update = (i: number, patch: Partial<Skill>) => set("skills", data.skills.map((s, n) => (n === i ? { ...s, ...patch } : s)));
  const add = () => set("skills", [...data.skills, { name: `skill-${data.skills.length + 1}`, description: "What this skill does.", version: "1.0.0", author: "", license: "", platforms: [], tags: [], body: "" }]);
  return (
    <>
      {data.skills.map((s, i) => (
        <div key={i} className="skill-card">
          <div className="row">
            <div className="grow"><Field value={s.name} onChange={(v) => update(i, { name: v })} mono ariaLabel="Skill name" error={errors[`skills.${i}.name`]} /></div>
            <button className="icon-btn" aria-label="Remove skill" onClick={() => set("skills", data.skills.filter((_, n) => n !== i))}><Trash2 size={14} /></button>
          </div>
          <Field value={s.description} onChange={(v) => update(i, { description: v })} ariaLabel="Skill description" placeholder="One sentence, 60 characters max." error={errors[`skills.${i}.description`]} />
          <Field value={s.body} onChange={(v) => update(i, { body: v })} multiline rows={5} mono ariaLabel="Skill instructions" placeholder="Steps the agent follows." />
        </div>
      ))}
      <button className="btn" onClick={add}><Plus size={14} /> Add skill</button>
    </>
  );
}

function RunBox({ agentNodeId, profile }: { agentNodeId: string; profile: string }) {
  const { boardId } = useBoard();
  const runs = useApp((s) => s.runs);
  const events = useApp((s) => s.events);
  const openChat = useApp((s) => s.openChat);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const latest = useMemo(() => latestRunByAgent(runs).get(agentNodeId) ?? null, [runs, agentNodeId]);
  const tools = latest ? (events[latest.runId] ?? []).filter((e) => e.type === "run.tool.started") : [];
  const running = latest?.status === "running";

  const go = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    useApp.getState().setCompile({ compileOpen: false });
    await runAgent(boardId, agentNodeId, prompt.trim());
    setBusy(false);
  };

  return (
    <>
      <div className="composer" style={{ boxShadow: "none", background: "var(--bg-input)", maxWidth: "none", margin: 0 }}>
        <textarea rows={2} value={prompt} placeholder={`Ask ${profile}…`} data-testid="run-prompt" onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void go(); } }} />
        {running
          ? <button className="send stop" aria-label="Stop" onClick={() => latest && engine.cancelRun(latest.runId)}><Square size={12} /></button>
          : <button className="send" aria-label="Run" disabled={!prompt.trim() || busy} onClick={go} data-testid="run-button"><ArrowUp size={16} /></button>}
      </div>
      {latest && (
        <div className="stack" data-testid="run-result">
          <div className="row" style={{ flexWrap: "wrap", gap: "4px 10px", fontSize: 12 }}>
            <span className={`chip ${latest.status === "succeeded" ? "ok" : latest.status === "running" ? "run" : "fail"}`}>{latest.status}</span>
            {latest.tokens && <span className="faint num">{fmtTokens(latest.tokens.input)} in · {fmtTokens(latest.tokens.output)} out</span>}
            {latest.finishedAt && <span className="faint num">{duration(latest.finishedAt - latest.startedAt)}</span>}
            {(latest.reportedUsd || latest.estimatedUsd) ? <span className="faint num">{usd(latest.reportedUsd || latest.estimatedUsd)}</span> : null}
          </div>
          {tools.length > 0 && <div className="steps">{tools.map((e) => <span key={e.seq} className="step-chip"><Plug size={11} /><span className="mono">{e.type === "run.tool.started" ? e.tool : ""}</span></span>)}</div>}
          {(latest.text || latest.error) && <div className="bubble" style={{ background: "var(--bg-raised)", border: "1px solid var(--line)" }} data-testid="run-output">{(latest.text || latest.error || "").trim()}</div>}
          <button className="btn ghost sm" style={{ justifySelf: "start" }} onClick={() => openChat(agentNodeId)}><MessagesSquare size={13} /> Open chat</button>
        </div>
      )}
    </>
  );
}

function ModelFields({ data, set }: { data: ModelData; set: (f: string, v: unknown) => void }) {
  const errors = fieldErrors(ModelDataSchema, data);
  const price = data.pricing;
  const setPrice = (k: "inputPerMTok" | "outputPerMTok", v: string) => {
    const n = v.trim() === "" ? 0 : Number(v);
    const next = { inputPerMTok: price?.inputPerMTok ?? 0, outputPerMTok: price?.outputPerMTok ?? 0, [k]: Number.isFinite(n) ? n : 0 };
    set("pricing", next.inputPerMTok === 0 && next.outputPerMTok === 0 ? null : next);
  };
  return (
    <>
      <Segmented value={data.endpoint} onChange={(v) => set("endpoint", v)} options={[{ value: "local", label: "Local" }, { value: "cloud", label: "Cloud" }]} />
      <Field label="Endpoint" value={data.baseUrl} onChange={(v) => set("baseUrl", v)} mono error={errors.baseUrl} />
      <Field label="Model" value={data.model} onChange={(v) => set("model", v)} mono error={errors.model ? "Required" : null} />
      <Field label="API key variable" value={data.apiKeyEnv} onChange={(v) => set("apiKeyEnv", v)} mono error={errors.apiKeyEnv} placeholder={data.endpoint === "cloud" ? "OPENROUTER_API_KEY" : "optional"} note="Only the name is stored, never the key." />
      <Field label="Key" value={data.name} onChange={(v) => set("name", v)} mono error={errors.name} />
      <div className="grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="$ / 1M in" type="number" value={price ? String(price.inputPerMTok) : ""} onChange={(v) => setPrice("inputPerMTok", v)} />
        <Field label="$ / 1M out" type="number" value={price ? String(price.outputPerMTok) : ""} onChange={(v) => setPrice("outputPerMTok", v)} />
      </div>
    </>
  );
}

const parsePairs = (text: string, sep: "=" | ":") =>
  Object.fromEntries(text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf(sep);
    return i < 0 ? [l, ""] : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }).filter(([k]) => k));

function ToolFields({ data, set }: { data: ToolData; set: (f: string, v: unknown) => void }) {
  const errors = fieldErrors(ToolDataSchema, data);
  return (
    <>
      <Segmented value={data.transport} onChange={(v) => set("transport", v)} options={[{ value: "stdio", label: "Local" }, { value: "http", label: "Remote" }]} />
      <Field label="Key" value={data.name} onChange={(v) => set("name", v)} mono error={errors.name} />
      {data.transport === "stdio" ? (
        <>
          <Field label="Command" value={data.command} onChange={(v) => set("command", v)} mono placeholder="npx" />
          <TextListField label="Arguments" value={data.args.join("\n")} onCommit={(t) => set("args", t.split("\n").map((s) => s.trim()).filter(Boolean))} rows={4} placeholder="One per line" />
          <TextListField label="Environment" value={Object.entries(data.env).map(([k, v]) => `${k}=${v}`).join("\n")} onCommit={(t) => set("env", parsePairs(t, "="))} rows={2} placeholder="KEY=value or KEY=${env:SECRET}" />
        </>
      ) : (
        <>
          <Field label="URL" value={data.url} onChange={(v) => set("url", v)} mono />
          <TextListField label="Headers" value={Object.entries(data.headers).map(([k, v]) => `${k}: ${v}`).join("\n")} onCommit={(t) => set("headers", parsePairs(t, ":"))} rows={2} placeholder="Authorization: Bearer ${env:TOKEN}" />
        </>
      )}
    </>
  );
}

