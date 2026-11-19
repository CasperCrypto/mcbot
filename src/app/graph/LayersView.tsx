/**
 * The harness in layers (graph/layers.ts): pick an agent, see its surfaces, loop, context, model,
 * tools, plugins and guardrails stacked outside in. A click on a row opens what changes it: the
 * block on the Board (its inspector) or the view that holds it.
 */
import { Brain, Cpu, Puzzle, Radio, Repeat, ShieldCheck, Wrench } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { resolveGraph } from "../../compile";
import type { AgentMemoryView, AgentSchedules, InstalledPlugin } from "../../contracts/api";
import { engine, REMOTE } from "../lib/engine";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { AgentFace } from "../ui";
import { harnessLayers, type LayerId, type LayerTarget } from "./layers";

const ICONS: Record<LayerId, ReactNode> = {
  surfaces: <Radio size={15} />, loop: <Repeat size={15} />, context: <Brain size={15} />, model: <Cpu size={15} />,
  tools: <Wrench size={15} />, plugins: <Puzzle size={15} />, guardrails: <ShieldCheck size={15} />,
};

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
    plugins, installedSkills: installed,
  });
  const open = (t: LayerTarget) => {
    if ("node" in t) onEdit(t.node);
    else useApp.getState().setTab(t.tab);
  };

  return (
    <div className="layers-view" data-testid="layers">
      <div className="layers-agents" role="tablist" aria-label="Agent">
        {bundles.map((b) => (
          <button key={b.agent.id} role="tab" className="suggest-card" aria-pressed={b === current} onClick={() => setAgentId(b.agent.id)}>
            <AgentFace seed={b.agent.data.name} size={22} />
            <span className="ellipsis">{b.agent.data.displayName || b.agent.data.name}</span>
          </button>
        ))}
      </div>
      <div className="layers-stack">
        {layers.map((l) => (
          <section key={l.id} className={`layer layer-${l.id}`} data-testid={`layer-${l.id}`}>
            <header className="layer-head" data-tip={l.what} data-tip-side="right">{ICONS[l.id]}<b>{l.title}</b></header>
            <div className="layer-items">
              {l.items.map((it) => (
                <button key={`${it.label}-${it.detail}`} className="layer-item" data-state={it.state} onClick={() => open(it.target)}
                  data-tip={it.state === "default" ? "Hermes' default" : it.state === "missing" ? "Needed to work" : "Set on the board"}>
                  <span className="layer-label ellipsis">{it.label}</span>
                  <span className="layer-detail ellipsis">{it.detail}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
