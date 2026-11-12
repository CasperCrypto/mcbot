/**
 * The whole Hermes harness behind this board, drawn: the gateway that runs everything, the chat
 * apps it serves, and for every agent its model chain, abilities, skills, tools, makers, memory and
 * schedules, plus the shared task board agents hand work through. Read-only: the board is where
 * you change it (and it follows Hermes, decision 9).
 */
import { Bot, Brain, CalendarClock, Cpu, Image, ListChecks, MessagesSquare, Plug, Server, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { compiledToolsets } from "../../compile/config";
import { resolveGraph } from "../../compile";
import { CAPABILITIES, DEFAULT_CAPABILITIES, PLATFORMS } from "../../contracts/graph";
import type { AgentMemoryView, AgentSchedules } from "../../contracts/api";
import { engine } from "../lib/engine";
import { GraphCanvas, type GEdge, type GNode } from "../views/GraphCanvas";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { AgentFace } from "../ui";

const MAX_CHIPS = 6;
/** About how tall a box draws, so a column never overlaps (header, then up to two rows of chips). */
const boxHeight = (lines?: string[]) => 54 + (lines?.length ? (Math.min(lines.length, MAX_CHIPS + 1) > 4 ? 52 : 28) : 0);
const label = (k: string) => CAPABILITIES.find((c) => c.key === k)?.label ?? k;

function Box({ icon, title, sub, lines, tone }: { icon: React.ReactNode; title: string; sub?: string; lines?: string[]; tone?: string }) {
  return (
    <div className="hx" data-tone={tone}>
      <div className="hx-head"><span className="hx-icon">{icon}</span><span className="grow"><b>{title}</b>{sub && <span className="faint">{sub}</span>}</span></div>
      {lines && lines.length > 0 && (
        <div className="hx-chips">
          {lines.slice(0, MAX_CHIPS).map((l) => <span key={l} className="hx-chip">{l}</span>)}
          {lines.length > MAX_CHIPS && <span className="hx-chip more">+{lines.length - MAX_CHIPS} more</span>}
        </div>
      )}
    </div>
  );
}

export function HermesView() {
  const { graph, boardId } = useBoard();
  const runs = useApp((s) => s.runs);
  const { bundles } = useMemo(() => resolveGraph(graph), [graph]);
  const [memory, setMemory] = useState<AgentMemoryView[]>([]);
  const [schedules, setSchedules] = useState<AgentSchedules[]>([]);
  useEffect(() => {
    let alive = true;
    engine.memory(boardId).then((m) => { if (alive) setMemory(m); }).catch(() => undefined);
    engine.schedules(boardId).then((s) => { if (alive) setSchedules(s); }).catch(() => undefined);
    return () => { alive = false; };
  }, [boardId, graph]);

  const { nodes, edges } = useMemo(() => {
    const nodes: GNode[] = [];
    const edges: GEdge[] = [];
    const ROW = 330;
    const busy = new Set(Object.values(runs).filter((r) => r.status === "running").map((r) => r.agentNodeId));
    const channels = bundles.flatMap((b) => b.channels.map((c) => ({ c, agent: b.agent })));
    const midY = Math.max(0, ((bundles.length - 1) * ROW) / 2);

    // Who reaches the agents: McBot itself (the runs API) and every chat app, through the gateway.
    nodes.push({ id: "in:mcbot", x: 0, y: midY - 60, content: <Box icon={<Sparkles size={14} />} title="McBot" sub="Chat, Home, Tasks · runs API" /> });
    channels.forEach(({ c }, i) => nodes.push({ id: `in:${c.id}`, x: 0, y: midY + 40 + i * 90, content: <Box icon={<MessagesSquare size={14} />} title={c.data.label || PLATFORMS[c.data.platform].label} sub={`${c.data.allowedUsers.length} allowed`} tone="channel" /> }));
    nodes.push({
      id: "gateway", x: 320, y: midY - 20,
      content: <Box icon={<Server size={14} />} title="Hermes gateway" sub="Runs every agent" lines={["Profiles", "Runs API", "Approvals", "Chat apps", "Schedules"]} tone="gateway" />,
    });
    edges.push({ id: "e:mcbot", source: "in:mcbot", target: "gateway" });
    channels.forEach(({ c }) => edges.push({ id: `e:in:${c.id}`, source: `in:${c.id}`, target: "gateway" }));

    const anyTeam = bundles.some((b) => b.team.length);
    let rowBottom = 0;
    bundles.forEach((b, i) => {
      // Each agent sits below the previous one's column of parts.
      const y = i === 0 ? 0 : Math.max(i * ROW, rowBottom + 220);
      const a = b.agent;
      const id = `agent:${a.id}`;
      const live = busy.has(a.id);
      nodes.push({ id, x: 640, y, content: (
        <div className="hx agent">
          <div className="hx-head"><AgentFace seed={a.data.name} size={30} status={live ? "running" : null} /><span className="grow"><b>{a.data.displayName || a.data.name}</b><span className="faint mono">profiles/{a.data.name}</span></span></div>
          <span className="faint hx-note">SOUL.md · config.yaml{a.data.skills.length ? " · skills/" : ""}</span>
        </div>
      ) });
      edges.push({ id: `e:g:${a.id}`, source: "gateway", target: id, live });

      const parts: { key: string; node: React.ReactNode; h: number }[] = [];
      const part = (key: string, node: React.ReactElement<{ lines?: string[] }>) => parts.push({ key, node, h: boxHeight(node.props.lines) });
      part("model", <Box icon={<Cpu size={14} />} title="Model" sub={b.models.map((m, n) => `${n ? "then " : ""}${m.data.model}`).join(" · ") || "None yet"} tone={b.models.length ? "model" : "warn"} />);
      const caps = compiledToolsets(b) ?? DEFAULT_CAPABILITIES;
      part("abilities", <Box icon={<Wrench size={14} />} title="Abilities" sub={`${caps.length} tool sets`} lines={caps.map(label)} />);
      if (b.tools.length) part("tools", <Box icon={<Plug size={14} />} title="MCP tools" lines={b.tools.map((t) => t.data.label || t.data.name)} tone="tool" />);
      if (b.image || b.video) part("makers", <Box icon={<Image size={14} />} title="Makers" lines={[b.image && `Images · ${b.image.data.provider}`, b.video && `Videos · ${b.video.data.provider}`].filter(Boolean) as string[]} tone="media" />);
      part("skills", <Box icon={<Bot size={14} />} title="Skills" sub={a.data.skills.length ? undefined : "Hermes' essential skills"} lines={a.data.skills.map((s) => s.name)} />);
      const mem = memory.find((m) => m.nodeId === a.id);
      part("memory", <Box icon={<Brain size={14} />} title="Memory" sub={mem ? `${mem.memory.entries.length} notes · ${mem.user.entries.length} about you` : "MEMORY.md · USER.md"} />);
      const jobs = schedules.find((s) => s.agentNodeId === a.id)?.schedules ?? [];
      if (jobs.length) part("cron", <Box icon={<CalendarClock size={14} />} title="Schedules" lines={jobs.map((j) => j.name || j.when)} />);

      const GAP = 20;
      const total = parts.reduce((t, p) => t + p.h + GAP, -GAP);
      let at = y + 40 - total / 2;
      parts.forEach((p) => {
        const pid = `${id}:${p.key}`;
        nodes.push({ id: pid, x: 960, y: at, content: p.node });
        edges.push({ id: `e:${pid}`, source: id, target: pid });
        at += p.h + GAP;
      });
      rowBottom = Math.max(rowBottom, at);
    });

    // Centre the gateway side on the agents as they were finally placed.
    const ys = nodes.filter((n) => n.id.startsWith("agent:") && !n.id.slice(6).includes(":")).map((n) => n.y);
    const shift = (ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0) - midY;
    for (const n of nodes) if (n.x < 640) n.y += shift;
    const center = midY + shift;
    if (anyTeam) {
      nodes.push({ id: "kanban", x: 1280, y: center, content: <Box icon={<ListChecks size={14} />} title="Task board" sub="kanban.db · shared by every agent" tone="gateway" /> });
      bundles.filter((b) => b.team.length).forEach((b) => edges.push({ id: `e:k:${b.agent.id}`, source: `agent:${b.agent.id}:skills`, target: "kanban" }));
    }
    nodes.push({ id: "approvals", x: 320, y: center + 150, content: <Box icon={<ShieldCheck size={14} />} title="Approvals" sub="Risky commands ask you first" tone="warn" /> });
    edges.push({ id: "e:approvals", source: "approvals", target: "gateway" });
    return { nodes, edges };
  }, [bundles, memory, schedules, runs]);

  if (!bundles.length) return <div className="empty"><h3>No agents yet</h3><p>Add one on the board, and its whole Hermes setup shows here.</p></div>;
  return (
    <div className="graph-area hermes-view" data-testid="hermes-view">
      <GraphCanvas key={`hermes:${boardId}`} nodes={nodes} edges={edges} fitSignature={`${boardId}:${nodes.length}:${memory.length}:${schedules.length}`} />
    </div>
  );
}
