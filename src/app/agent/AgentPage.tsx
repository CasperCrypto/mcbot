/**
 * One agent, everything about it on one page: who it is, what it thinks with, what it can reach,
 * its skills, what it may do and its limits. No tabs: one scroll, grouped like Settings. The
 * board's inspector and the Chat view's side pane both show it; every change is a board edit
 * (undoable, live for teammates), and nothing reaches Hermes until Compile.
 */
import { ArrowUp, ChevronRight, Cloud, Copy, Download, GraduationCap, HardDrive, MessagesSquare, Plug, Plus, Send, Trash2, Waypoints, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { addEdge, addNode, removeEdges, removeNodes, setNodeField, updateEdge } from "../../board/ydoc";
import { undo } from "../../board/undo";
import { resolveGraph } from "../../compile";
import type { LibrarySkill, SkillsView as SkillsState } from "../../contracts/api";
import { AgentDataSchema, CAPABILITIES, DEFAULT_CAPABILITIES, PLATFORMS, type Reasoning, type AgentNode, type GraphEdge, type GraphNode, type ModelNode } from "../../contracts/graph";
import { compileBoard } from "../actions";
import { Abilities, Skills as WrittenSkills, fieldErrors } from "../graph/Inspector";
import { LogoTile, ModelMark, modelTitle, modelWhere, nodeLogo } from "../graph/Logo";
import { MakerIcon } from "../graph/nodes";
import { duplicateNode, newId } from "../graph/defaults";
import { REMOTE, engine } from "../lib/engine";
import { ago } from "../lib/format";
import { attachModel, chainOf, otherEnd } from "../lib/models";
import { prettyName } from "../lib/names";
import { suggestSkills } from "../lib/suggestSkills";
import { useBoard } from "../state/board";
import { latestRunByAgent, useApp } from "../state/store";
import { AgentFace, Issues } from "../ui";

/** Hermes' reasoning levels as people pick them (the ladder's ends kept for models that offer them). */
const THINKING: { value: Reasoning; label: string; hint: string }[] = [
  { value: "none", label: "Off", hint: "Answers straight away" },
  { value: "low", label: "Light", hint: "A quick think first" },
  { value: "medium", label: "Medium", hint: "Thinks before it answers" },
  { value: "high", label: "Deep", hint: "Thinks hard: slower, costs more" },
  { value: "max", label: "Deepest", hint: "As much as the model allows" },
];

/** A titled group of rows, as Settings draws them. */
function Group({ title, children, foot, testId, action }: { title: string; children: ReactNode; foot?: ReactNode; testId?: string; action?: ReactNode }) {
  return (
    <section className="ap-group" data-testid={testId}>
      <h3><span className="grow">{title}</span>{action}</h3>
      <div className="ap-list">{children}</div>
      {foot && <p className="ap-foot">{foot}</p>}
    </section>
  );
}

/** A node's tile: its brand's logo, else its kind's glyph. */
function NodeTile({ node }: { node: GraphNode }) {
  if (node.kind === "model") return <LogoTile logo={nodeLogo(node)} kind={node.data.endpoint === "local" ? "model" : "cloud"} sm>{node.data.endpoint === "local" ? <HardDrive size={13} /> : <Cloud size={13} />}</LogoTile>;
  if (node.kind === "media") return <LogoTile logo={nodeLogo(node)} kind="media" sm><MakerIcon media={node.data.media} size={13} /></LogoTile>;
  if (node.kind === "channel") return <LogoTile logo={nodeLogo(node)} kind="channel" sm><Send size={12} /></LogoTile>;
  if (node.kind === "tool") return <LogoTile logo={nodeLogo(node)} kind="tool" sm><Plug size={13} /></LogoTile>;
  return <AgentFace seed={node.data.name} size={24} />;
}

function label(n: GraphNode): string {
  return n.kind === "agent" ? n.data.displayName || n.data.name : n.data.label || n.data.name;
}

function kindLine(n: GraphNode, e: GraphEdge, agentId: string): string {
  if (n.kind === "channel") return PLATFORMS[n.data.platform]?.label ?? "Chat app";
  if (n.kind === "media") return n.data.media === "video" ? "Makes videos" : "Makes images";
  if (n.kind === "tool") return n.data.transport === "http" ? "Online tool" : "Tool on this computer";
  if (n.kind === "agent") return e.source === agentId ? "Hands work to" : "Gets work from";
  return "";
}

export function AgentPage({ agent, where, onClose }: { agent: AgentNode; where: "board" | "chat"; onClose?: () => void }) {
  const { doc, graph, boardId } = useBoard();
  const runs = useApp((s) => s.runs);
  const a = agent.data;
  const name = a.displayName || a.name;
  const set = (field: string, value: unknown) => setNodeField(doc, agent.id, field, value);
  const errors = fieldErrors(AgentDataSchema, a);
  const issues = useMemo(() => resolveGraph(graph).issues.filter((i) => i.nodeId === agent.id), [graph, agent.id]);
  const latest = latestRunByAgent(runs).get(agent.id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [writing, setWriting] = useState(a.skills.length > 0);
  const [abilitiesOpen, setAbilitiesOpen] = useState(false);

  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const chain = chainOf(graph, agent.id).flatMap((edge) => {
    const m = byId.get(otherEnd(edge, agent.id) ?? "");
    return m?.kind === "model" ? [{ edge, model: m }] : [];
  });
  const linked = graph.edges.flatMap((edge) => {
    const n = byId.get(otherEnd(edge, agent.id) ?? "");
    return n && n.kind !== "model" && n.id !== agent.id ? [{ edge, node: n }] : [];
  });
  const models = graph.nodes.filter((n): n is ModelNode => n.kind === "model");
  const spare = models.filter((m) => !chain.some((c) => c.model.id === m.id));

  // Hermes' skills for this profile (host only): the library, what is installed, what it taught itself.
  const [skills, setSkills] = useState<SkillsState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setSkills(null);
    if (!REMOTE && a.name) engine.skills(a.name).then((v) => { if (live) setSkills(v); }).catch(() => undefined);
    return () => { live = false; };
  }, [a.name]);
  const installed = new Set(skills?.installed ?? []);
  const suggested = skills ? suggestSkills({ name, description: a.description, soul: a.soul }, skills.library, installed, 3) : [];
  const fromLibrary = (skills?.skills ?? []).filter((sk) => sk.origin === "library");
  const learned = (skills?.skills ?? []).filter((sk) => sk.origin === "learned" && !a.skills.some((own) => own.name === sk.name));

  const app = useApp.getState();
  const status = latest?.status === "running" ? (latest.approval ? { state: "warn", text: "Asks you before acting" } : { state: "run", text: "Working…" })
    : chain.length === 0 ? { state: "warn", text: "No model yet" }
    : latest?.status === "failed" ? { state: "fail", text: `Last run failed · ${ago(latest.finishedAt ?? latest.startedAt)}` }
    : { state: "ok", text: latest ? `Ready · last ran ${ago(latest.finishedAt ?? latest.startedAt)}` : "Ready" };

  const addModel = (modelId: string) => {
    if (modelId === "new") return app.openSettings("models");
    const { add, reorder } = attachModel(graph, modelId, [agent.id], chain.length === 0, () => newId("edge"));
    doc.transact(() => {
      for (const e of add) addEdge(doc, e);
      for (const r of reorder) updateEdge(doc, r.id, { order: r.order });
    });
  };
  const makeMain = (edgeId: string) => {
    const ordered = [chain.find((c) => c.edge.id === edgeId)!, ...chain.filter((c) => c.edge.id !== edgeId)];
    doc.transact(() => ordered.forEach((c, i) => updateEdge(doc, c.edge.id, { order: i })));
  };
  /** Take a tool off this agent; a block nobody else uses leaves the board with it. */
  const detach = (edge: GraphEdge, node: GraphNode) => {
    const shared = graph.edges.some((e) => e.id !== edge.id && (e.source === node.id || e.target === node.id));
    if (shared || node.kind === "agent") removeEdges(doc, [edge.id]);
    else removeNodes(doc, [node.id]);
  };
  const duplicate = () => {
    const copy = duplicateNode(graph, agent);
    doc.transact(() => {
      addNode(doc, copy);
      // The same models, tools and makers; a chat app is one bot for one agent, so it stays.
      for (const e of graph.edges) {
        const other = byId.get(otherEnd(e, agent.id) ?? "");
        if (!other || other.kind === "agent" || other.kind === "channel") continue;
        addEdge(doc, { ...e, id: newId("edge"), source: e.source === agent.id ? copy.id : e.source, target: e.target === agent.id ? copy.id : e.target });
      }
    });
    if (where === "chat") app.editAgent(copy.id);
    else app.select(copy.id);
    app.toast({ kind: "ok", text: `${label(copy)} made`, action: { label: "Undo", run: () => undo(doc) } });
  };
  const remove = () => {
    if (!confirmDelete) return setConfirmDelete(true);
    removeNodes(doc, [agent.id]);
    if (where === "chat") app.openChat(null);
    else app.select(null);
    app.toast({ kind: "ok", text: `${name} deleted`, action: { label: "Undo", run: () => undo(doc) } });
  };
  const install = async (s: LibrarySkill) => {
    setBusy(s.id);
    try {
      const r = await engine.installSkill(a.name, s.id);
      setSkills((prev) => (prev ? { ...prev, installed: r.installed } : prev));
      app.toast({ kind: "ok", text: `${prettyName(s.name)} added to ${name}` });
    } catch (e) {
      app.toast({ kind: "fail", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const openSkills = () => { app.select(agent.id); app.setTab("skills"); };
  const builtin = a.builtinSkills !== false;
  const allowed = new Set(a.capabilities ?? DEFAULT_CAPABILITIES);
  const can = CAPABILITIES.filter((c) => allowed.has(c.key));
  const makers = new Set(linked.flatMap((l) => (l.node.kind === "media" ? [l.node.data.media === "video" ? "video_gen" as const : "image_gen" as const] : [])));

  return (
    <div className="agent-page" data-testid="agent-page">
      <header className="ap-head">
        <AgentFace seed={a.name} size={54} status={latest?.status} />
        <div className="ap-id">
          <input className="ap-name" value={a.displayName} placeholder={a.name || "Name"} onChange={(e) => set("displayName", e.target.value)} aria-label="Name" data-testid="inspector-title" />
          <input className="ap-about" value={a.description} placeholder="What it does" onChange={(e) => set("description", e.target.value)} aria-label="What it does" data-testid="agent-about" />
          <span className="ap-status" data-state={status.state}><i />{status.text}</span>
        </div>
        {onClose && <button className="icon-btn" aria-label="Close" onClick={onClose} data-testid="agent-page-close"><X size={15} /></button>}
      </header>

      <div className="ap-actions">
        {where === "board"
          ? <button className="ap-action" onClick={() => app.openChat(agent.id)} data-testid="agent-chat"><MessagesSquare /><span>Chat</span></button>
          : <button className="ap-action" onClick={() => { app.setTab("graph"); app.select(agent.id); }} data-testid="agent-board"><Waypoints /><span>Board</span></button>}
        <button className="ap-action" onClick={openSkills} data-testid="open-skills"><GraduationCap /><span>Skills</span></button>
        <button className="ap-action" onClick={duplicate} data-testid="agent-duplicate"><Copy /><span>Duplicate</span></button>
        <button className="ap-action danger" onClick={remove} onBlur={() => setConfirmDelete(false)} data-testid="agent-delete"><Trash2 /><span>{confirmDelete ? "Sure?" : "Delete"}</span></button>
      </div>

      {issues.length > 0 && <Issues issues={issues} />}

      <Group title="Personality" testId="agent-soul" foot="Who it is, how it talks, what it never does. Goes into its SOUL.md.">
        <textarea className="ap-soul" value={a.soul} onChange={(e) => set("soul", e.target.value)} rows={5} aria-label="Personality" placeholder={"Who this agent is.\nHow it speaks. What it avoids."} />
      </Group>

      <Group title="Thinks with" testId="agent-models" foot={chain.length > 1 ? "When the main model fails, the next one answers." : undefined}>
        {chain.map((c, i) => (
          <div key={c.edge.id} className="ap-row" data-testid="agent-model">
            <span className="tile sm model-tile"><ModelMark model={c.model.data.model} baseUrl={c.model.data.baseUrl} size={18} /></span>
            <span className="t" data-tip={c.model.data.model || undefined}><b>{modelTitle(c.model.data)}</b><small>{modelWhere(c.model.data)}</small></span>
            <span className={`chip${i === 0 ? " run" : ""}`}>{i === 0 ? "Main" : "Backup"}</span>
            {i > 0 && <button className="icon-btn sm" aria-label="Make main" data-tip="Make main" onClick={() => makeMain(c.edge.id)}><ArrowUp size={13} /></button>}
            <button className="icon-btn sm" aria-label={`Stop using ${label(c.model)}`} data-tip="Stop using" onClick={() => removeEdges(doc, [c.edge.id])}><X size={13} /></button>
          </div>
        ))}
        {spare.length > 0 || models.length === 0 ? (
          <label className="ap-row add">
            <Plus size={14} />
            <select value="" onChange={(e) => addModel(e.target.value)} aria-label={chain.length ? "Add a backup model" : "Pick a model"} data-testid="agent-add-model">
              <option value="" disabled>{chain.length ? "Add a backup model" : "Pick a model"}</option>
              {spare.map((m) => <option key={m.id} value={m.id}>{modelTitle(m.data)} · {modelWhere(m.data)}</option>)}
              <option value="new">New model…</option>
            </select>
          </label>
        ) : (
          <button className="ap-row add" onClick={() => app.openSettings("models")}><Plus size={14} /><span>New model…</span></button>
        )}
        <label className="ap-row" data-testid="agent-reasoning" data-tip="How hard it thinks before it answers (agent.reasoning_effort). Deeper costs more and takes longer; models that cannot think ignore it.">
          <span className="t"><b>Thinking</b><small>{a.reasoning ? THINKING.find((t) => t.value === a.reasoning)?.hint ?? a.reasoning : "As the model decides"}</small></span>
          <select className="ap-select" value={a.reasoning ?? ""} onChange={(e) => set("reasoning", e.target.value || null)} aria-label="Thinking">
            <option value="">Default</option>
            {THINKING.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
      </Group>

      <Group title="Tools and apps" testId="agent-tools">
        {linked.map(({ edge, node }) => (
          <div key={edge.id} className="ap-row">
            <NodeTile node={node} />
            <button className="t link" onClick={() => (node.kind === "agent" ? app.editAgent(node.id) : (app.setTab("graph"), app.select(node.id)))} data-tip="Open its settings">
              <b>{label(node)}</b><small>{kindLine(node, edge, agent.id)}</small>
            </button>
            <button className="icon-btn sm" aria-label={`Remove ${label(node)}`} data-tip="Remove" onClick={() => detach(edge, node)}><X size={13} /></button>
          </div>
        ))}
        <div className="ap-row ap-adds">
          <button className="btn sm" onClick={() => app.addTo("tool", agent.id)} data-testid="agent-add-tool"><Plug size={13} /> Tool</button>
          <button className="btn sm" onClick={() => app.addTo("app", agent.id)} data-testid="agent-add-app"><Send size={12} /> Chat app</button>
          {linked.length === 0 && <span className="faint ap-hint">Web search, files, GitHub, Slack…</span>}
        </div>
      </Group>

      <Group title="Skills" testId="skill-library" action={!REMOTE ? <button className="btn ghost sm" onClick={openSkills}>All skills <ChevronRight size={12} /></button> : undefined}>
        <div className="ap-row">
          <span className="t"><b>Hermes' built-in skills</b><small>44 everyday skills, on for every agent</small></span>
          <button type="button" className="switch" role="switch" aria-checked={builtin} aria-label="Hermes' built-in skills" data-testid="builtin-skills" onClick={() => set("builtinSkills", builtin ? false : null)}><span /></button>
        </div>
        {fromLibrary.length + learned.length > 0 && (
          <div className="ap-row">
            <span className="t"><b>{fromLibrary.length + learned.length} more</b>
              <small className="ellipsis">{[...fromLibrary, ...learned].map((sk) => prettyName(sk.name)).join(", ")}</small></span>
          </div>
        )}
        {skills && !skills.compiled ? (
          <div className="ap-row"><span className="t"><b>Library skills</b><small>Compile once, then add them</small></span>
            <button className="btn sm" onClick={() => void compileBoard(boardId)}>Compile</button></div>
        ) : suggested.map((s) => (
          <div key={s.id} className="ap-row" data-testid="agent-suggested-skill">
            <span className="t"><b>{prettyName(s.name)}</b><small className="ellipsis">{s.description}</small></span>
            <button className="btn sm" disabled={busy === s.id} onClick={() => void install(s)}><Download size={12} /> {busy === s.id ? "Adding…" : "Add"}</button>
          </div>
        ))}
        <button className="ap-row add" onClick={() => setWriting(!writing)} aria-expanded={writing}><Plus size={14} /><span>{a.skills.length ? `Written here (${a.skills.length})` : "Write a skill"}</span></button>
        {writing && <div className="ap-written"><WrittenSkills data={a} set={set} /></div>}
      </Group>

      <Group title="Can use" testId="abilities-group">
        <button className="ap-row" onClick={() => setAbilitiesOpen(!abilitiesOpen)} aria-expanded={abilitiesOpen} data-testid="abilities-toggle">
          <span className="t"><b>{can.length} of {CAPABILITIES.length} abilities</b><small>{can.map((c) => c.label).join(", ")}</small></span>
          <ChevronRight size={14} className="ap-chev" data-open={abilitiesOpen || undefined} />
        </button>
        {abilitiesOpen && <div className="ap-written"><Abilities data={a} set={set} forced={makers} title="" /></div>}
      </Group>

      <Group title="Limits" testId="limits">
        <label className="ap-row" data-testid="budget" data-tip="Warns at 80%; at 100% new runs stop for the day (UTC). Kept in McBot, never compiled.">
          <span className="t"><b>Daily budget</b><small>Stops new runs at the limit</small></span>
          <span className="ap-num"><span className="faint">$</span>
            <input type="number" min={0} step={0.5} placeholder="None" data-testid="budget-input" aria-label="Daily budget in dollars"
              value={a.dailyBudgetUsd ?? ""} onChange={(e) => { const n = parseFloat(e.target.value); set("dailyBudgetUsd", Number.isFinite(n) && n > 0 ? n : null); }} /></span>
        </label>
        <label className="ap-row" data-testid="loop" data-tip="How many tool steps one message may take before Hermes stops (agent.max_turns).">
          <span className="t"><b>Steps per message</b><small>Tool steps before it stops</small></span>
          <span className="ap-num">
            <input type="number" min={1} max={10000} step={5} placeholder="Any" data-testid="loop-input" aria-label="Steps per message"
              value={a.maxSteps ?? ""} onChange={(e) => { const n = parseInt(e.target.value, 10); set("maxSteps", Number.isFinite(n) && n > 0 ? Math.min(n, 10000) : null); }} /></span>
        </label>
      </Group>

      <Group title="Advanced" foot={errors.name ?? "Its folder in Hermes: profiles/<name>. Letters, numbers and dashes."}>
        <label className="ap-row">
          <span className="t"><b>Profile name</b></span>
          <input className="ap-profile mono" value={a.name} onChange={(e) => set("name", e.target.value)} aria-label="Profile name" aria-invalid={!!errors.name} data-testid="agent-name" />
        </label>
      </Group>
    </div>
  );
}
