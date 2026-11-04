import { ArrowUp, Bot, Cloud, HardDrive, Play, Plug, Plus, Square, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { removeNodes, setNodeField, updateEdge } from "../../board/ydoc";
import { AgentDataSchema, ModelDataSchema, ToolDataSchema, type AgentData, type GraphNode, type ModelData, type Skill, type ToolData } from "../../contracts/graph";
import type { Issue } from "../../compile";
import { runAgent } from "../actions";
import { engine } from "../lib/engine";
import { duration, tokens as fmtTokens, usd } from "../lib/format";
import { useBoard } from "../state/board";
import { latestRunByAgent, useApp } from "../state/store";
import { Field, Issues, Segmented, TextListField } from "../ui";

type FieldErrors = Record<string, string>;

function fieldErrors(schema: { safeParse(v: unknown): { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } } }, data: unknown): FieldErrors {
  const r = schema.safeParse(data);
  if (r.success || !r.error) return {};
  const out: FieldErrors = {};
  for (const i of r.error.issues) {
    const key = i.path.map(String).join(".");
    out[key] ??= i.message;
  }
  return out;
}

export function Inspector({ node, issues }: { node: GraphNode; issues: Issue[] }) {
  const { doc } = useBoard();
  const select = useApp((s) => s.select);
  const set = (field: string, value: unknown) => setNodeField(doc, node.id, field, value);
  const Icon = node.kind === "agent" ? Bot : node.kind === "tool" ? Plug : (node.data as ModelData).endpoint === "local" ? HardDrive : Cloud;
  const title = node.kind === "agent" ? (node.data as AgentData).displayName || node.data.name : (node.data as ModelData | ToolData).label || node.data.name;

  return (
    <aside className="inspector" aria-label="Inspector" data-testid="inspector">
      <div className="inspector-head">
        <div className={`node-glyph ${node.kind}`}><Icon size={15} /></div>
        <div className="title">
          <b className="ellipsis">{title || "Untitled"}</b>
          <small>{node.kind === "agent" ? "Agent · Hermes profile" : node.kind === "model" ? "Model · providers entry" : "Tool · MCP server"}</small>
        </div>
        <button className="icon-btn" title="Delete node" aria-label="Delete node" onClick={() => { removeNodes(doc, [node.id]); select(null); }}><Trash2 size={15} /></button>
        <button className="icon-btn" title="Close" aria-label="Close inspector" onClick={() => select(null)}><X size={15} /></button>
      </div>
      <div className="inspector-body">
        <Issues issues={issues} />
        {node.kind === "agent" && <AgentFields node={node} set={set} />}
        {node.kind === "model" && <ModelFields data={node.data} set={set} />}
        {node.kind === "tool" && <ToolFields data={node.data} set={set} />}
      </div>
    </aside>
  );
}

function AgentFields({ node, set }: { node: Extract<GraphNode, { kind: "agent" }>; set: (f: string, v: unknown) => void }) {
  const a = node.data;
  const errors = fieldErrors(AgentDataSchema, a);
  const { graph, doc } = useBoard();
  const edges = graph.edges.filter((e) => e.source === node.id || e.target === node.id);
  const linked = edges
    .map((e) => ({ edge: e, other: graph.nodes.find((n) => n.id === (e.source === node.id ? e.target : e.source)) }))
    .filter((x): x is { edge: typeof x.edge; other: GraphNode } => !!x.other);
  const chain = linked.filter((x) => x.other.kind === "model").sort((x, y) => x.edge.order - y.edge.order || (x.edge.id < y.edge.id ? -1 : 1));
  const tools = linked.filter((x) => x.other.kind === "tool");

  const makePrimary = (edgeId: string) => {
    const ordered = [chain.find((c) => c.edge.id === edgeId)!, ...chain.filter((c) => c.edge.id !== edgeId)];
    doc.transact(() => ordered.forEach((c, i) => updateEdge(doc, c.edge.id, { order: i })));
  };

  const setSkill = (i: number, patch: Partial<Skill>) => set("skills", a.skills.map((s, n) => (n === i ? { ...s, ...patch } : s)));
  const skillErrors = (i: number) => fieldErrors(AgentDataSchema, a)[`skills.${i}.name`] ?? fieldErrors(AgentDataSchema, a)[`skills.${i}.description`];

  return (
    <>
      <div className="inspector-section">
        <Field label="Profile name" value={a.name} onChange={(v) => set("name", v)} mono error={errors.name} help={<>Runs as <code>hermes -p {a.name || "…"}</code></>} testId="agent-name" />
        <Field label="Display name" value={a.displayName} onChange={(v) => set("displayName", v)} />
        <Field label="Description" value={a.description} onChange={(v) => set("description", v)} multiline rows={2} help="Written to profile.yaml." />
        <Field label="SOUL.md" value={a.soul} onChange={(v) => set("soul", v)} multiline rows={6} mono placeholder={`# ${a.displayName || a.name}\n\nWho this agent is, how it speaks, what it avoids.`} help="The agent's identity — slot #1 of its system prompt." />
      </div>

      <div className="inspector-section">
        <p className="section-title">MODEL CHAIN</p>
        {chain.length === 0 ? (
          <span className="faint">Drag from a model's handle onto this agent.</span>
        ) : (
          <div className="chain">
            {chain.map((c, i) => (
              <div key={c.edge.id} className="chain-item">
                <span className={`badge ${i === 0 ? "model" : ""}`}>{i === 0 ? "Primary" : `Fallback ${i}`}</span>
                <span className="mono ellipsis" style={{ flex: 1 }}>{(c.other.data as ModelData).model || c.other.data.name}</span>
                {i > 0 && <button className="icon-btn" title="Make primary" aria-label="Make primary" onClick={() => makePrimary(c.edge.id)}><ArrowUp size={14} /></button>}
              </div>
            ))}
          </div>
        )}
        {tools.length > 0 && (
          <div className="chain">
            {tools.map((t) => (
              <div key={t.edge.id} className="chain-item"><span className="badge tool">MCP</span><span className="mono ellipsis">{t.other.data.name}</span></div>
            ))}
          </div>
        )}
      </div>

      <div className="inspector-section">
        <div className="row"><p className="section-title" style={{ margin: 0, flex: 1 }}>SKILLS</p>
          <button className="btn sm" onClick={() => set("skills", [...a.skills, { name: `skill-${a.skills.length + 1}`, description: "Describe what this skill does.", version: "1.0.0", author: "", license: "", platforms: [], tags: [], body: "" }])}><Plus size={13} /> Skill</button>
        </div>
        {a.skills.length === 0 && <span className="faint">Skills compile to <code>skills/&lt;name&gt;/SKILL.md</code>.</span>}
        {a.skills.map((s, i) => (
          <div key={i} className="skill">
            <div className="row">
              <div style={{ flex: 1 }}><Field label="Name" value={s.name} onChange={(v) => setSkill(i, { name: v })} mono /></div>
              <button className="icon-btn" title="Remove skill" aria-label="Remove skill" style={{ alignSelf: "end", marginBottom: 2 }} onClick={() => set("skills", a.skills.filter((_, n) => n !== i))}><Trash2 size={14} /></button>
            </div>
            <Field label={`Description (${s.description.length}/60)`} value={s.description} onChange={(v) => setSkill(i, { description: v })} error={skillErrors(i)} />
            <Field label="Instructions" value={s.body} onChange={(v) => setSkill(i, { body: v })} multiline rows={4} mono placeholder="Markdown the agent reads when it uses this skill." />
          </div>
        ))}
      </div>

      <RunBox agentNodeId={node.id} />
    </>
  );
}

function RunBox({ agentNodeId }: { agentNodeId: string }) {
  const { boardId } = useBoard();
  const runs = useApp((s) => s.runs);
  const events = useApp((s) => s.events);
  const setTab = useApp((s) => s.setTab);
  const selectRun = useApp((s) => s.selectRun);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const latest = useMemo(() => latestRunByAgent(runs).get(agentNodeId) ?? null, [runs, agentNodeId]);
  const steps = latest ? (events[latest.runId] ?? []).filter((e) => e.type === "run.tool.started" || e.type === "run.tool.finished") : [];
  const running = latest?.status === "running";
  // Keep the newest result in view as it starts, streams and finishes.
  useEffect(() => {
    if (latest) requestAnimationFrame(() => box.current?.scrollIntoView({ block: "end", behavior: "smooth" }));
  }, [latest?.runId, latest?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    useApp.getState().setCompile({ compileOpen: false });
    const id = await runAgent(boardId, agentNodeId, prompt.trim());
    setBusy(false);

  };

  return (
    <div className="inspector-section run-box" ref={box}>
      <div className="row"><p className="section-title" style={{ margin: 0, flex: 1 }}>RUN</p>
        {latest && <button className="btn ghost sm" onClick={() => { selectRun(latest.runId); setTab("workflows"); }}>Timeline</button>}
      </div>
      <label className="field">
        <textarea rows={3} value={prompt} placeholder="Ask this agent something…  (⌘↩ to run)" data-testid="run-prompt"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void go(); } }} />
      </label>
      <div className="row">
        {running ? (
          <button className="btn" onClick={() => latest && engine.cancelRun(latest.runId)}><Square size={12} /> Stop</button>
        ) : (
          <button className="btn primary" disabled={!prompt.trim() || busy} onClick={go} data-testid="run-button"><Play size={12} /> Run</button>
        )}
        <span className="faint" style={{ fontSize: 11 }}>Runs the compiled profile with Hermes.</span>
      </div>
      {latest && (
        <div className="run-box" data-testid="run-result">
          <div className="row" style={{ fontSize: 12, flexWrap: "wrap", gap: "4px 10px" }}>
            <span className={`badge ${latest.status === "succeeded" ? "ok" : latest.status === "running" ? "run" : "fail"}`}>{latest.status}</span>
            {latest.tokens && <span className="faint num" style={{ whiteSpace: "nowrap" }}>{fmtTokens(latest.tokens.input)} in · {fmtTokens(latest.tokens.output)} out</span>}
            {latest.finishedAt && <span className="faint num" style={{ whiteSpace: "nowrap" }}>{duration(latest.finishedAt - latest.startedAt)}</span>}
            {(latest.reportedUsd || latest.estimatedUsd) ? <span className="faint num" style={{ whiteSpace: "nowrap" }}>{usd(latest.reportedUsd || latest.estimatedUsd)}</span> : null}
          </div>
          {steps.filter((e) => e.type === "run.tool.started").map((e) => (
            <div key={e.seq} className="step"><Plug size={12} className="faint" /><span className="mono">{e.type === "run.tool.started" ? e.tool : ""}</span></div>
          ))}
          {(latest.text || latest.error) && <div className="run-output" data-testid="run-output">{(latest.text || latest.error || "").trim()}</div>}
        </div>
      )}
    </div>
  );
}

function ModelFields({ data, set }: { data: ModelData; set: (f: string, v: unknown) => void }) {
  const errors = fieldErrors(ModelDataSchema, data);
  const price = data.pricing;
  const setPrice = (k: "inputPerMTok" | "outputPerMTok", v: string) => {
    const n = v.trim() === "" ? null : Number(v);
    const next = { inputPerMTok: price?.inputPerMTok ?? 0, outputPerMTok: price?.outputPerMTok ?? 0, [k]: n ?? 0 };
    set("pricing", n === null && !(k === "inputPerMTok" ? price?.outputPerMTok : price?.inputPerMTok) ? null : next);
  };
  return (
    <>
      <div className="inspector-section">
        <Segmented value={data.endpoint} onChange={(v) => set("endpoint", v)} options={[{ value: "local", label: "Local endpoint" }, { value: "cloud", label: "Cloud endpoint" }]} />
        <Field label="Name" value={data.name} onChange={(v) => set("name", v)} mono error={errors.name} help={<>Written as <code>providers.mcbot-{data.name || "…"}</code></>} />
        <Field label="Label" value={data.label} onChange={(v) => set("label", v)} />
        <Field label="Base URL" value={data.baseUrl} onChange={(v) => set("baseUrl", v)} mono error={errors.baseUrl} help={data.endpoint === "local" ? "Ollama :11434/v1, LM Studio :1234/v1, vLLM, llama.cpp…" : "Any OpenAI-compatible API."} />
        <Field label="Model id" value={data.model} onChange={(v) => set("model", v)} mono error={errors.model ? "Model id is required" : null} />
        <Field label={data.endpoint === "cloud" ? "API key env var" : "API key env var (optional)"} value={data.apiKeyEnv} onChange={(v) => set("apiKeyEnv", v)} mono error={errors.apiKeyEnv}
          help="Only the variable's name is stored and compiled (key_env). Set its value in your environment or the profile's .env." />
      </div>
      <div className="inspector-section">
        <p className="section-title">PRICING · OPTIONAL</p>
        <div className="grid-2">
          <Field label="$ / 1M input" type="number" value={price ? String(price.inputPerMTok) : ""} onChange={(v) => setPrice("inputPerMTok", v)} />
          <Field label="$ / 1M output" type="number" value={price ? String(price.outputPerMTok) : ""} onChange={(v) => setPrice("outputPerMTok", v)} />
        </div>
        <span className="faint" style={{ fontSize: 11 }}>McBot-only. Used to estimate cost when Hermes reports none (custom and local endpoints).</span>
      </div>
    </>
  );
}

const parseEnv = (text: string, sep: "=" | ":") =>
  Object.fromEntries(text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf(sep);
    return i < 0 ? [l, ""] : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }).filter(([k]) => k));

function ToolFields({ data, set }: { data: ToolData; set: (f: string, v: unknown) => void }) {
  const errors = fieldErrors(ToolDataSchema, data);
  return (
    <div className="inspector-section">
      <Segmented value={data.transport} onChange={(v) => set("transport", v)} options={[{ value: "stdio", label: "Local process" }, { value: "http", label: "Remote URL" }]} />
      <Field label="Name" value={data.name} onChange={(v) => set("name", v)} mono error={errors.name} help={<>Hermes exposes its tools as <code>mcp__{(data.name || "…").replace(/[^A-Za-z0-9_]/g, "_")}__*</code></>} />
      <Field label="Label" value={data.label} onChange={(v) => set("label", v)} />
      {data.transport === "stdio" ? (
        <>
          <Field label="Command" value={data.command} onChange={(v) => set("command", v)} mono placeholder="npx" />
          <TextListField label="Arguments (one per line)" value={data.args.join("\n")} onCommit={(t) => set("args", t.split("\n").map((s) => s.trim()).filter(Boolean))} rows={4} />
          <TextListField label="Environment (KEY=value)" value={Object.entries(data.env).map(([k, v]) => `${k}=${v}`).join("\n")} onCommit={(t) => set("env", parseEnv(t, "="))} rows={2}
            help={<>Reference secrets as <code>{"${env:NAME}"}</code>; values resolve from the profile's .env.</>} />
        </>
      ) : (
        <>
          <Field label="URL" value={data.url} onChange={(v) => set("url", v)} mono />
          <TextListField label="Headers (Name: value)" value={Object.entries(data.headers).map(([k, v]) => `${k}: ${v}`).join("\n")} onCommit={(t) => set("headers", parseEnv(t, ":"))} rows={2} />
        </>
      )}
    </div>
  );
}
