/**
 * The harness in layers (graph/layers.ts): pick an agent, see its surfaces, loop, context, model,
 * tools, plugins and guardrails stacked outside in, and change them right there. The agent's own
 * settings (steps per message, helpers, thinking, daily budget) are controls in their row; every
 * other row opens what changes it: the block on the Board (its inspector) or the view that holds it.
 */
import { Brain, ChevronRight, Cpu, MessageSquare, Puzzle, Radio, Repeat, ShieldCheck, Wrench } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { resolveGraph } from "../../compile";
import type { AgentBundle } from "../../compile/validate";
import type { AgentMemoryView, AgentSchedules, InstalledPlugin } from "../../contracts/api";
import { DEFAULT_CAPABILITIES, REASONING_LEVELS, type Capability } from "../../contracts/graph";
import { setNodeField } from "../../board/ydoc";
import { engine, REMOTE } from "../lib/engine";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { AgentFace } from "../ui";
import { ModelChip } from "./Logo";
import { harnessLayers, type LayerId, type LayerItem, type LayerTarget } from "./layers";

const ICONS: Record<LayerId, ReactNode> = {
  surfaces: <Radio size={16} />, loop: <Repeat size={16} />, context: <Brain size={16} />, model: <Cpu size={16} />,
  tools: <Wrench size={16} />, plugins: <Puzzle size={16} />, guardrails: <ShieldCheck size={16} />,
};

const THINKING: Record<string, string> = {
  none: "Off", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max", ultra: "Ultra",
};

/** The control for a row that is one of the agent's own settings. */
function Editor({ item, bundle }: { item: LayerItem; bundle: AgentBundle }) {
  const { doc } = useBoard();
  const a = bundle.agent.data;
  const set = (field: string, value: unknown) => setNodeField(doc, bundle.agent.id, field, value ?? undefined);
  switch (item.edit) {
    case "maxSteps":
      return (
        <input className="layer-input num" type="number" min={1} max={10000} placeholder="No limit" aria-label="Steps per message" data-testid="layer-edit-maxSteps"
          value={a.maxSteps ?? ""} onChange={(e) => { const n = parseInt(e.target.value, 10); set("maxSteps", Number.isFinite(n) && n > 0 ? Math.min(n, 10000) : null); }} />
      );
    case "dailyBudgetUsd":
      return (
        <span className="layer-money">
          <span className="faint">$</span>
          <input className="layer-input num" type="number" min={0} step={0.5} placeholder="No limit" aria-label="Daily budget in dollars" data-testid="layer-edit-dailyBudgetUsd"
            value={a.dailyBudgetUsd ?? ""} onChange={(e) => { const n = parseFloat(e.target.value); set("dailyBudgetUsd", Number.isFinite(n) && n > 0 ? n : null); }} />
        </span>
      );
    case "reasoning":
      return (
        <select className="layer-select" value={a.reasoning ?? ""} aria-label="Thinking" data-testid="layer-edit-reasoning" onChange={(e) => set("reasoning", e.target.value || null)}>
          <option value="">As the model decides</option>
          {REASONING_LEVELS.map((l) => <option key={l} value={l}>{THINKING[l] ?? l}</option>)}
        </select>
      );
    case "helpers": {
      const caps = a.capabilities ?? DEFAULT_CAPABILITIES;
      const on = caps.includes("delegation");
      const toggle = () => {
        const next: Capability[] = on ? caps.filter((c) => c !== "delegation") : [...caps, "delegation"];
        const same = next.length === DEFAULT_CAPABILITIES.length && DEFAULT_CAPABILITIES.every((c) => next.includes(c));
        set("capabilities", same ? null : next);
      };
      return <button type="button" className="switch" role="switch" aria-checked={on} aria-label="Helpers" data-testid="layer-edit-helpers" onClick={toggle}><span /></button>;
    }
    default:
      return null;
  }
}

export function LayersView({ onEdit }: { onEdit: (nodeId: string) => void }) {
  const { graph, boardId } = useBoard();
  const { bundles } = useMemo(() => resolveGraph(graph), [graph]);
  const selected = useApp((s) => s.selectedNodeId);
  const [agentId, setAgentId] = useState<string | null>(null);
  const current = bundles.find((b) => b.agent.id === (agentId ?? selected)) ?? bundles[0] ?? null;
  const profile = current?.agent.data.name ?? null;

  const [memory, setMemory] = useState<AgentMemoryView[]>([]);
  const [schedules, setSchedules] = useState<AgentSchedules[]>([]);
  const [plugins, setPlugins] = useState<InstalledPlugin[] | null>(null);
  const [installed, setInstalled] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    engine.memory(boardId).then((m) => { if (alive) setMemory(m); }).catch(() => undefined);
    engine.schedules(boardId).then((s) => { if (alive) setSchedules(s); }).catch(() => undefined);
    return () => { alive = false; };
  }, [boardId]);
  useEffect(() => {
    let alive = true;
    setPlugins(null);
    setInstalled(null);
    // Skills and plugins are the host's (a teammate's window can't list them).
    if (profile && !REMOTE) {
      engine.plugins(profile).then((p) => { if (alive) setPlugins(p.installed); }).catch(() => undefined);
      engine.skills(profile).then((s) => { if (alive) setInstalled(s.installed); }).catch(() => undefined);
    }
    return () => { alive = false; };
  }, [profile]);

  if (!current) return <div className="empty"><h3>No agents yet</h3><p>Add one, then see its harness here.</p></div>;
  const layers = harnessLayers(current, {
    memory: memory.find((m) => m.nodeId === current.agent.id) ?? null,
    schedules: schedules.find((s) => s.agentNodeId === current.agent.id)?.schedules ?? null,
    plugins, installedSkills: installed, brief: graph.brief ?? null,
  });
  const open = (t: LayerTarget) => {
    if ("node" in t) onEdit(t.node);
    else if ("sheet" in t) useApp.getState().setKnowledgeOpen(true);
    else useApp.getState().setTab(t.tab);
  };
  const a = current.agent.data;

  return (
    <div className="layers-view" data-testid="layers">
      {bundles.length > 1 && (
        <div className="layers-agents" role="tablist" aria-label="Agent">
          {bundles.map((b) => (
            <button key={b.agent.id} role="tab" className="layers-agent" aria-selected={b === current} onClick={() => setAgentId(b.agent.id)}>
              <AgentFace seed={b.agent.data.name} size={22} />
              <span className="ellipsis">{b.agent.data.displayName || b.agent.data.name}</span>
            </button>
          ))}
        </div>
      )}
      <div className="layers-stack">
        <header className="layers-who">
          <AgentFace seed={a.name} size={44} />
          <div className="grow layers-who-text">
            <h2 className="ellipsis">{a.displayName || a.name}</h2>
            <p className="ellipsis">{a.description || "No purpose written yet"}</p>
          </div>
          {current.models[0] && <ModelChip model={current.models[0].data.model} baseUrl={current.models[0].data.baseUrl} more={current.models.length - 1} />}
          <button className="btn sm" onClick={() => useApp.getState().openChat(current.agent.id)}><MessageSquare size={13} /> Chat</button>
          <button className="btn sm" onClick={() => onEdit(current.agent.id)}>On the board</button>
        </header>
        {layers.map((l) => (
          <section key={l.id} className={`layer layer-${l.id}`} data-testid={`layer-${l.id}`}>
            <header className="layer-head" data-tip={l.what} data-tip-side="right">{ICONS[l.id]}<b>{l.title}</b><span className="layer-what">{l.what}</span></header>
            <div className="layer-items">
              {l.items.map((it) => it.edit ? (
                <div key={`${it.label}-${it.detail}`} className="layer-item editable" data-state={it.state}>
                  <span className="layer-text">
                    <span className="layer-label ellipsis">{it.label}</span>
                    <span className="layer-detail ellipsis">{it.detail}</span>
                  </span>
                  <Editor item={it} bundle={current} />
                </div>
              ) : (
                <button key={`${it.label}-${it.detail}`} className="layer-item" data-state={it.state} onClick={() => open(it.target)}
                  data-tip={it.state === "default" ? "Hermes' default" : it.state === "missing" ? "Needed to work" : "Set on the board"}>
                  <span className="layer-text">
                    <span className="layer-label ellipsis">{it.label}</span>
                    <span className="layer-detail ellipsis">{it.detail}</span>
                  </span>
                  {it.state === "missing" && <span className="layer-flag">Needed</span>}
                  <ChevronRight size={15} className="layer-go" />
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
