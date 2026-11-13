import { ArrowUp, Check, CheckCheck, Cloud, Download, HardDrive, LogIn, MessagesSquare, Plug, Plus, RotateCcw, Search, Send, Square, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { removeNodes, setNodeField, updateEdge } from "../../board/ydoc";
import type { Issue } from "../../compile";
import {
  AgentDataSchema, CAPABILITIES, ChannelDataSchema, PLATFORMS, channelKeyName, type Platform, DEFAULT_CAPABILITIES, MEDIA_PROVIDERS, MediaDataSchema, ModelDataSchema, ToolDataSchema,
  type AgentData, type Capability, type ChannelData, type GraphNode, type MediaData, type ModelData, type Skill, type ToolData,
} from "../../contracts/graph";
import { runAgent } from "../actions";
import { keyEnvFor } from "../lib/providers";
import { REMOTE, engine } from "../lib/engine";
import type { LibrarySkill } from "../../contracts/api";
import { duration, tokens as fmtTokens, usd } from "../lib/format";
import { useBoard } from "../state/board";
import { latestRunByAgent, useApp } from "../state/store";
import { AgentFace, Field, Issues, Segmented, TextListField } from "../ui";
import { MakerIcon } from "./nodes";

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
  const title = node.kind === "agent" ? node.data.displayName : node.data.label;
  const sub = node.kind === "agent" ? `@${node.data.name || "…"}`
    : node.kind === "model" ? (node.data.endpoint === "local" ? "Local model" : "Cloud model")
    : node.kind === "media" ? (node.data.media === "video" ? "Video maker" : "Image maker")
    : node.kind === "channel" ? "Chat app" : "MCP server";

  return (
    <aside className="inspector glass" aria-label="Inspector" data-testid="inspector">
      <div className="inspector-head">
        {node.kind === "agent" ? <AgentFace seed={node.data.name} size={42} status={status} />
          : node.kind === "media" ? <span className="tile media"><MakerIcon media={node.data.media} size={16} /></span>
          : node.kind === "channel" ? <span className="tile channel"><Send size={15} /></span>
          : <span className={`tile ${node.kind === "tool" ? "tool" : node.data.endpoint === "local" ? "model" : "cloud"}`}>
            {node.kind === "tool" ? <Plug size={16} /> : node.data.endpoint === "local" ? <HardDrive size={16} /> : <Cloud size={16} />}
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
          {node.kind === "tool" && <ToolFields nodeId={node.id} data={node.data} set={set} />}
          {node.kind === "media" && <MakerFields data={node.data} set={set} />}
          {node.kind === "channel" && <ChannelFields data={node.data} set={set} />}
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
        {tab === "skills" && <><Skills data={node.data} set={set} />{!REMOTE && <SkillLibrary data={node.data} set={set} />}</>}
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
  const tools = linked.filter((x) => x.other.kind === "tool" || x.other.kind === "channel");
  const makers = linked.filter((x): x is { edge: typeof x.edge; other: Extract<GraphNode, { kind: "media" }> } => x.other.kind === "media");
  const makePrimary = (edgeId: string) => {
    const ordered = [chain.find((c) => c.edge.id === edgeId)!, ...chain.filter((c) => c.edge.id !== edgeId)];
    doc.transact(() => ordered.forEach((c, i) => updateEdge(doc, c.edge.id, { order: i })));
  };

  return (
    <>
      <Field label="Profile" value={a.name} onChange={(v) => set("name", v)} mono error={errors.name} testId="agent-name" />
      <Field label="Description" value={a.description} onChange={(v) => set("description", v)} multiline rows={2} />
      <Field label="Soul" value={a.soul} onChange={(v) => set("soul", v)} multiline rows={7} placeholder={"Who this agent is.\nHow it speaks. What it avoids."} />
      <div className="stack">
        <span className="section-label">Models</span>
        {chain.length === 0 ? <span className="faint">Connect a model to this agent.</span> : (
          <div className="chain">
            {chain.map((c, i) => (
              <div key={c.edge.id} className="chain-item">
                <span className="chip">{i === 0 ? "Primary" : `Fallback ${i}`}</span>
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
              <div key={t.edge.id} className="chain-item">{t.other.kind === "channel" ? <Send size={13} className="faint" /> : <Plug size={13} className="faint" />}<span className="grow ellipsis">{(t.other.data as ToolData | ChannelData).label || t.other.data.name}</span><span className="chip mono">{t.other.data.name}</span></div>
            ))}
          </div>
        </div>
      )}
      <Budget data={a} set={set} />
      <Abilities data={a} set={set} forced={new Set(makers.map((m): Capability => (m.other.data.media === "video" ? "video_gen" : "image_gen")))} />
    </>
  );
}

/** A daily spend limit. McBot-side only: it is never written to Hermes' files. */
function Budget({ data, set }: { data: AgentData; set: (f: string, v: unknown) => void }) {
  return (
    <div className="stack" style={{ gap: 6 }} data-testid="budget">
      <span className="section-label">Daily budget</span>
      <label className="row" style={{ gap: 6 }} data-tip="Alerts you in Home at 80% and 100% of this day's spend (UTC). Never compiled." data-tip-side="top">
        <span className="faint">$</span>
        <input className="input mono" type="number" min={0} step={0.5} placeholder="No limit" data-testid="budget-input"
          value={data.dailyBudgetUsd ?? ""} onChange={(e) => { const n = parseFloat(e.target.value); set("dailyBudgetUsd", Number.isFinite(n) && n > 0 ? n : null); }} />
      </label>
    </div>
  );
}

/**
 * The tool sets this agent may use. Untouched, it follows Hermes' default; the first
 * change pins a list (platform_toolsets.cli). A wired maker keeps its own tool set on.
 */
function Abilities({ data, set, forced }: { data: AgentData; set: (f: string, v: unknown) => void; forced: Set<Capability> }) {
  const on = new Set<Capability>(data.capabilities ?? DEFAULT_CAPABILITIES);
  const toggle = (k: Capability) => {
    const next = new Set(on);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    set("capabilities", CAPABILITIES.map((c) => c.key).filter((c) => next.has(c)));
  };
  return (
    <div className="stack" data-testid="abilities">
      <div className="row">
        <span className="section-label grow">Abilities</span>
        {on.size < CAPABILITIES.length && (
          <button className="icon-btn sm" aria-label="Turn all on" data-tip="Turn all on" data-tip-side="top" data-testid="abilities-all" onClick={() => set("capabilities", CAPABILITIES.map((c) => c.key))}><CheckCheck size={13} /></button>
        )}
        {data.capabilities != null && (
          <button className="icon-btn sm" aria-label="Back to defaults" data-tip="Back to defaults" data-tip-side="top" onClick={() => set("capabilities", null)}><RotateCcw size={12} /></button>
        )}
      </div>
      <div className="abilities">
        {CAPABILITIES.map((c) => {
          const locked = forced.has(c.key);
          const active = locked || on.has(c.key);
          return (
            <button key={c.key} type="button" className="ability" aria-pressed={active} disabled={locked} onClick={() => toggle(c.key)}
              data-tip={locked ? "On: a maker is connected" : undefined} data-tip-side="top" data-testid={`ability-${c.key}`}>
              {active && <Check size={11} strokeWidth={2.6} />}{c.label}
            </button>
          );
        })}
      </div>
      {on.has("browser") && <BrowserSettings data={data} set={set} />}
    </div>
  );
}

/** How its browser runs: Hermes' `browser.headed`, `browser.engine`, `browser.use_real_profile`. */
function BrowserSettings({ data, set }: { data: AgentData; set: (f: string, v: unknown) => void }) {
  const b = { show: false, engine: "chromium" as const, myLogins: false, ...(data.browser ?? {}) };
  const put = (patch: Partial<typeof b>) => {
    const next = { ...b, ...patch };
    set("browser", next.show || next.engine !== "chromium" || next.myLogins ? next : null);
  };
  const row = (label: string, tip: string, on: boolean, flip: () => void, id: string) => (
    <button type="button" className="ability" aria-pressed={on} onClick={flip} data-tip={tip} data-tip-side="top" data-testid={id}>{label}</button>
  );
  return (
    <div className="stack" style={{ gap: 6 }} data-testid="browser-settings">
      <span className="section-label">Browser</span>
      <div className="abilities">
        {row("Show its window", "Watch it browse, live, in its own Chromium window", b.show, () => put({ show: !b.show }), "browser-show")}
        {row("Fast engine", "Lightpanda: much faster, no screenshots. Install it first: lightpanda.io", b.engine === "lightpanda", () => put({ engine: b.engine === "lightpanda" ? "chromium" : "lightpanda" }), "browser-fast")}
        {row("Use my logins", "Browses with a copy of your own browser's logins", b.myLogins, () => put({ myLogins: !b.myLogins }), "browser-logins")}
      </div>
    </div>
  );
}

/**
 * A Telegram bot for one agent. The token comes from @BotFather; only the ids listed may talk to
 * it (Hermes refuses everyone else). It answers while this computer and McBot's gateway are on.
 */
function ChannelFields({ data, set }: { data: ChannelData; set: (f: string, v: unknown) => void }) {
  const errors = fieldErrors(ChannelDataSchema, data);
  const p: Platform = PLATFORMS[data.platform];
  const [ids, setIds] = useState(data.allowedUsers.join(", "));
  const userError = Object.entries(errors).find(([k]) => k.startsWith("allowedUsers"))?.[1];
  const telegram = data.platform === "telegram";
  return (
    <>
      {/* Secrets are saved in McBot under the bot's own names; plain settings sit on the board. */}
      {p.required.map((f) => f.secret
        ? <KeyField key={f.env} name={channelKeyName(data, f.env)} label={f.prompt} placeholder={f.url ? `From ${f.url.replace(/^https?:\/\//, "")}` : "Paste it here"} />
        : <Field key={f.env} label={f.prompt} value={data.settings[f.env] ?? ""} mono testId={`channel-${f.env}`}
            onChange={(v) => set("settings", { ...data.settings, [f.env]: v })} />)}
      {p.allowedUsersEnv && (
        <Field label="Allowed users" value={ids} mono placeholder={`Your ${p.label} user id`} testId="channel-users"
          error={userError ? "One id each, separated by commas" : telegram && data.allowedUsers.some((u) => !/^\d+$/.test(u)) ? "Numbers only, like 123456789" : null}
          onChange={(v) => { setIds(v); set("allowedUsers", v.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean)); }} />
      )}
      {telegram && <Field label="Bot API server" value={data.apiBase} onChange={(v) => set("apiBase", v.trim())} mono placeholder="api.telegram.org" error={errors.apiBase} />}
      <Field label="ID" value={data.name} onChange={(v) => set("name", v)} mono error={errors.name} />
    </>
  );
}

function MakerFields({ data, set }: { data: MediaData; set: (f: string, v: unknown) => void }) {
  const errors = fieldErrors(MediaDataSchema, data);
  const services = MEDIA_PROVIDERS[data.media] as Record<string, { label: string; keyEnv: string }>;
  const service = services[data.provider];
  return (
    <>
      <label className="field">
        <span>Service</span>
        <select value={service ? data.provider : ""} onChange={(e) => set("provider", e.target.value)} data-testid="maker-service">
          {!service && <option value="" disabled>Pick a service</option>}
          {Object.entries(services).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}
        </select>
      </label>
      {service && <KeyField name={service.keyEnv} />}
      <Field label="Model" value={data.model} onChange={(v) => set("model", v)} mono placeholder="Service default" />
      <Field label="ID" value={data.name} onChange={(v) => set("name", v)} mono error={errors.name} />
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

/**
 * Hermes' own skills for this agent: its bundled set (seeded after a compile unless turned off)
 * and the official library, installed into the compiled agent with `hermes skills install`.
 */
function SkillLibrary({ data, set }: { data: AgentData; set: (f: string, v: unknown) => void }) {
  const [library, setLibrary] = useState<LibrarySkill[]>([]);
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const builtin = data.builtinSkills !== false;
  useEffect(() => {
    let live = true;
    engine.skills(data.name).then((v) => { if (live) { setLibrary(v.library); setInstalled(new Set(v.installed)); } }).catch(() => undefined);
    return () => { live = false; };
  }, [data.name]);
  const install = async (s: LibrarySkill) => {
    setBusy(s.id);
    try {
      const r = await engine.installSkill(data.name, s.id);
      setInstalled(new Set(r.installed));
      useApp.getState().toast({ kind: "ok", text: `${s.name} installed for ${data.displayName || data.name}` });
    } catch (e) {
      useApp.getState().toast({ kind: "fail", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  const words = q.trim().toLowerCase();
  const shown = library.filter((s) => !words || `${s.name} ${s.category} ${s.description} ${s.tags.join(" ")}`.toLowerCase().includes(words)).slice(0, words ? 40 : 12);
  return (
    <div className="stack" style={{ gap: 8 }} data-testid="skill-library">
      <span className="section-label">Hermes skills</span>
      <div className="abilities">
        <button type="button" className="ability" aria-pressed={builtin} onClick={() => set("builtinSkills", builtin ? false : null)} data-testid="builtin-skills"
          data-tip="Hermes' 44 bundled skills, added when you compile" data-tip-side="top">
          {builtin && <Check size={11} strokeWidth={2.6} />}Built-in skills
        </button>
      </div>
      {library.length > 0 && (
        <>
          <label className="catalog-search"><Search size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${library.length} more`} aria-label="Search Hermes skills" data-testid="skill-search" /></label>
          <div className="chain">
            {shown.map((s) => {
              const has = installed.has(s.name);
              return (
                <div key={s.id} className="chain-item" data-tip={s.description} data-tip-side="left">
                  <span className="grow ellipsis">{s.name}</span>
                  <span className="chip">{s.category}</span>
                  {has ? <Check size={13} className="faint" aria-label="Installed" />
                    : <button className="icon-btn sm" aria-label={`Install ${s.name}`} disabled={busy !== null} onClick={() => void install(s)} data-testid={`install-${s.name}`}><Download size={13} /></button>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
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
      {data.endpoint === "cloud" && <KeyField name={data.apiKeyEnv || keyNameFor(data)} error={errors.apiKeyEnv} onSaved={(n) => { if (data.apiKeyEnv !== n) set("apiKeyEnv", n); }} />}
      <Field label="ID" value={data.name} onChange={(v) => set("name", v)} mono error={errors.name} />
      <div className="grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="$ / 1M in" type="number" value={price ? String(price.inputPerMTok) : ""} onChange={(v) => setPrice("inputPerMTok", v)} />
        <Field label="$ / 1M out" type="number" value={price ? String(price.outputPerMTok) : ""} onChange={(v) => setPrice("outputPerMTok", v)} />
      </div>
    </>
  );
}

/** The variable a cloud key is saved under: the usual one for known services, else one per model node. */
const keyNameFor = (d: ModelData) => keyEnvFor(d.baseUrl, d.name);

/**
 * A key, typed once and kept on this computer by the engine, never on the board: the
 * board only names its variable. Shared by cloud models and makers.
 */
function KeyField({ name, error, onSaved, label = "API key", placeholder = "Paste your key" }: { name: string; error?: string; onSaved?: (name: string) => void; label?: string; placeholder?: string }) {
  const [saved, setSaved] = useState<string[] | null>(null);
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    engine.secrets().then((r) => setSaved(r.names)).catch(() => setSaved([]));
  }, []);
  const has = !!saved?.includes(name);
  useEffect(() => {
    if (has) onSaved?.(name);
  }, [has, name]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    try {
      const r = await engine.setSecret(name, value);
      onSaved?.(name);
      setSaved(r.names);
      setValue("");
      setEditing(false);
      setProblem(null);
    } catch (err) {
      setProblem((err as Error).message);
    }
  };
  if (has && !editing) {
    return (
      <div className="field">
        <span>{label}</span>
        <div className="row key-saved" data-testid="api-key-saved">
          <Check size={14} className="ok-text" /><span className="grow" data-tip={`Saved as ${name}`} data-tip-side="top">Saved on this computer</span>
          <button className="btn ghost sm" onClick={() => setEditing(true)}>Change</button>
        </div>
      </div>
    );
  }
  return (
    <div className="key-entry">
      <Field label={label} type="password" value={value} onChange={(v) => { setValue(v); setProblem(null); }} placeholder={placeholder} error={problem ?? error ?? null} testId="api-key" />
      <button className="btn" disabled={!value.trim()} onClick={() => void save()} data-testid="api-key-save">Save</button>
    </div>
  );
}

const parsePairs = (text: string, sep: "=" | ":") =>
  Object.fromEntries(text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf(sep);
    return i < 0 ? [l, ""] : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }).filter(([k]) => k));

function ToolFields({ nodeId, data, set }: { nodeId: string; data: ToolData; set: (f: string, v: unknown) => void }) {
  const errors = fieldErrors(ToolDataSchema, data);
  const { graph } = useBoard();
  const agents = graph.edges.flatMap((e) => (e.source === nodeId ? [e.target] : e.target === nodeId ? [e.source] : []))
    .map((id) => graph.nodes.find((n) => n.id === id)).filter((n): n is Extract<GraphNode, { kind: "agent" }> => n?.kind === "agent");
  const signIn = async (profile: string) => {
    try {
      await engine.signIn(profile, data.name);
      useApp.getState().toast({ kind: "ok", text: "Finish signing in in your browser" });
    } catch (e) {
      useApp.getState().toast({ kind: "fail", text: e instanceof Error ? e.message : String(e) });
    }
  };
  // Keys it reads as ${env:NAME}: saved in McBot, written to the agent's .env before each run.
  const keys = [...new Set([...Object.values(data.env), ...Object.values(data.headers)].flatMap((v) => [...v.matchAll(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]!)))];
  return (
    <>
      {keys.map((k) => <KeyField key={k} name={k} label={keys.length > 1 ? k : "API key"} />)}
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
          {data.auth === "oauth" && !REMOTE && (
            <div className="stack" style={{ gap: 6 }} data-testid="tool-signin">
              <span className="section-label">Sign in</span>
              {agents.length === 0 ? <span className="faint">Connect it to an agent, then compile.</span>
                : agents.map((a) => (
                  <button key={a.id} className="btn" onClick={() => void signIn(a.data.name)} data-tip="Opens your browser to sign in for this agent" data-tip-side="top">
                    <LogIn size={14} /> {agents.length > 1 ? `Sign in for ${a.data.displayName || a.data.name}` : "Sign in"}
                  </button>
                ))}
            </div>
          )}
          <TextListField label="Headers" value={Object.entries(data.headers).map(([k, v]) => `${k}: ${v}`).join("\n")} onCommit={(t) => set("headers", parsePairs(t, ":"))} rows={2} placeholder="Authorization: Bearer ${env:TOKEN}" />
        </>
      )}
    </>
  );
}

