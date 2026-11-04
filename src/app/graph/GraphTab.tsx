import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Bot, Cloud, HardDrive, Plug, Server } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addEdge, addNode, moveNode, removeEdges, removeNodes } from "../../board/ydoc";
import { resolveGraph } from "../../compile";
import type { GraphNode, ModelData } from "../../contracts/graph";
import { useBoard } from "../state/board";
import { latestRunByAgent, toolActivity, useApp } from "../state/store";
import { CompileSheet } from "./CompileSheet";
import { Cursors } from "./Cursors";
import { newAgent, newId, newModel, newTool } from "./defaults";
import { Inspector } from "./Inspector";
import { nodeTypes, type FlowNode } from "./nodes";

const PAIRS = new Set(["agent:model", "model:agent", "agent:tool", "tool:agent"]);

function Canvas() {
  const { graph, doc, peers, setCursor } = useBoard();
  const selectedNodeId = useApp((s) => s.selectedNodeId);
  const select = useApp((s) => s.select);
  const runs = useApp((s) => s.runs);
  const events = useApp((s) => s.events);
  const compileOpen = useApp((s) => s.compileOpen);
  const compileRes = useApp((s) => s.compile);
  const health = useApp((s) => s.health);
  const flow = useReactFlow();
  const wrap = useRef<HTMLDivElement>(null);

  const resolved = useMemo(() => resolveGraph(graph), [graph]);
  const issuesByNode = useMemo(() => {
    const m = new Map<string, typeof resolved.issues>();
    for (const i of resolved.issues) if (i.nodeId) m.set(i.nodeId, [...(m.get(i.nodeId) ?? []), i]);
    return m;
  }, [resolved]);
  const latest = useMemo(() => latestRunByAgent(runs), [runs]);
  const activity = useMemo(() => toolActivity(events, runs), [events, runs]);
  const compiledProfiles = useMemo(() => new Set(compileRes?.ok ? compileRes.report.profiles.map((p) => p.name) : []), [compileRes]);
  const peerOnNode = useMemo(() => new Map(peers.filter((p) => p.selection).map((p) => [p.selection!, p])), [peers]);

  const [rfNodes, setRfNodes] = useState<FlowNode[]>([]);
  useEffect(() => {
    setRfNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      return graph.nodes.map((n): FlowNode => {
        const p = old.get(n.id);
        const bundle = resolved.bundles.find((b) => b.agent.id === n.id);
        const chain = bundle ? bundle.models.map((m) => (m.data as ModelData).model || m.data.name) : [];
        const run = n.kind === "agent" ? latest.get(n.id) ?? null : null;
        return {
          id: n.id,
          type: n.kind,
          position: p?.dragging ? p.position : n.position,
          selected: n.id === selectedNodeId,
          dragging: p?.dragging,
          measured: p?.measured,
          data: {
            node: n,
            hasError: (issuesByNode.get(n.id) ?? []).some((i) => i.level === "error"),
            peer: peerOnNode.get(n.id) ?? null,
            run,
            chain,
            tools: bundle?.tools.length ?? 0,
            compiled: n.kind !== "agent" || compiledProfiles.has(String(n.data.name)) || !!run,
            active: activity.active.has(n.id),
            errored: activity.errored.has(n.id),
          },
        };
      });
    });
  }, [graph, resolved, issuesByNode, latest, activity, compiledProfiles, peerOnNode, selectedNodeId]);

  const rfEdges = useMemo<Edge[]>(() => graph.edges.flatMap((e): Edge[] => {
    const s = graph.nodes.find((n) => n.id === e.source);
    const t = graph.nodes.find((n) => n.id === e.target);
    if (!s || !t) return [];
    const agent = s.kind === "agent" ? s : t.kind === "agent" ? t : null;
    const other = agent === s ? t : s;
    const running = agent ? latest.get(agent.id)?.status === "running" : false;
    if (agent && other.kind === "model") return [{ id: e.id, source: other.id, target: agent.id, sourceHandle: "out", targetHandle: "in", animated: running }];
    if (agent && other.kind === "tool") return [{ id: e.id, source: agent.id, target: other.id, sourceHandle: "out", targetHandle: "in", className: activity.active.has(other.id) ? "live" : undefined }];
    return [{ id: e.id, source: e.source, target: e.target, style: { stroke: "var(--fail)", strokeDasharray: "4 3" } }];
  }), [graph, latest, activity]);

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    setRfNodes((nds) => applyNodeChanges(changes, nds));
    const removed: string[] = [];
    for (const c of changes) {
      if (c.type === "position" && c.position) moveNode(doc, c.id, c.position);
      if (c.type === "remove") removed.push(c.id);
      if (c.type === "select" && c.selected) select(c.id);
    }
    if (removed.length) {
      removeNodes(doc, removed);
      if (removed.includes(useApp.getState().selectedNodeId ?? "")) select(null);
    }
  }, [doc, select]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const removed = changes.filter((c) => c.type === "remove").map((c) => c.id);
    if (removed.length) removeEdges(doc, removed);
  }, [doc]);

  const kindOf = useCallback((id: string | null) => graph.nodes.find((n) => n.id === id)?.kind, [graph]);
  const isValidConnection = useCallback((c: Connection | Edge) => {
    if (!PAIRS.has(`${kindOf(c.source)}:${kindOf(c.target)}`)) return false;
    return !graph.edges.some((e) => (e.source === c.source && e.target === c.target) || (e.source === c.target && e.target === c.source));
  }, [graph, kindOf]);

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || !isValidConnection(c)) return;
    const agentId = kindOf(c.source) === "agent" ? c.source : c.target;
    const order = graph.edges.filter((e) => (e.source === agentId || e.target === agentId) && [e.source, e.target].some((id) => kindOf(id) === "model")).length;
    addEdge(doc, { id: newId("edge"), source: agentId, target: agentId === c.source ? c.target : c.source, order });
  }, [doc, graph, isValidConnection, kindOf]);

  /** Agents at the centre, models to their left, tools to their right, stacked by count. */
  const spot = (kind: GraphNode["kind"]) => {
    const r = wrap.current?.getBoundingClientRect();
    const c = flow.screenToFlowPosition({ x: (r?.left ?? 0) + (r?.width ?? 800) / 2, y: (r?.top ?? 0) + (r?.height ?? 600) / 2 });
    const agents = graph.nodes.filter((n) => n.kind === "agent");
    const sel = kind === "agent" ? undefined : agents.find((n) => n.id === useApp.getState().selectedNodeId) ?? agents.at(-1);
    const anchor = sel ? { x: sel.position.x + 124, y: sel.position.y + 50 } : c;
    const dx = kind === "model" ? -360 : kind === "tool" ? 360 : 0;
    const x = Math.round(anchor.x - 124 + dx);
    let y = Math.round(anchor.y - 50);
    // Step down until the new card (≈248×140) overlaps no existing card.
    const taken = (yy: number) => graph.nodes.some((n) => Math.abs(n.position.x - x) < 260 && Math.abs(n.position.y - yy) < 150);
    for (let i = 0; i < 40 && taken(y); i++) y += 160;
    return { x, y };
  };
  const place = (node: GraphNode) => {
    addNode(doc, node);
    select(node.id);
  };

  const selected = graph.nodes.find((n) => n.id === selectedNodeId) ?? null;

  return (
    <div className="canvas-wrap" ref={wrap}
      onMouseMove={(e) => setCursor(flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }))}
      onMouseLeave={() => setCursor(null)}>
      <div className="palette" role="toolbar" aria-label="Add nodes">
        <button onClick={() => place(newAgent(graph, spot("agent")))} data-testid="add-agent"><Bot size={14} color="var(--agent)" /> Agent</button>
        <div className="sep" />
        <button onClick={() => place(newModel(graph, "local", spot("model")))} data-testid="add-model-local"><HardDrive size={14} color="var(--model)" /> Local model</button>
        <button onClick={() => place(newModel(graph, "cloud", spot("model")))} data-testid="add-model-cloud"><Cloud size={14} color="var(--model)" /> Cloud model</button>
        <div className="sep" />
        <button onClick={() => place(newTool(graph, "filesystem", spot("tool"), health?.workspace ?? null))} data-testid="add-tool-files"><Plug size={14} color="var(--tool)" /> Files tool</button>
        <button onClick={() => place(newTool(graph, "stdio", spot("tool"), null))} data-testid="add-tool"><Server size={14} color="var(--tool)" /> MCP server</button>
      </div>

      {graph.nodes.length === 0 && (
        <div className="canvas-hint">
          <div className="inner">
            <h2>Draw your harness</h2>
            <span>Add an agent, give it a model, wire in tools — then Compile.</span>
            <span className="faint">Every node becomes real Hermes files on disk.</span>
          </div>
        </div>
      )}

      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        connectionMode={ConnectionMode.Loose}
        onPaneClick={() => select(null)}
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
        deleteKeyCode={["Backspace", "Delete"]}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="var(--canvas-dot)" />
        <Controls position="bottom-left" showInteractive={false} />
        {graph.nodes.length > 4 && <MiniMap position="bottom-right" pannable zoomable style={{ marginRight: selected ? 360 : 12 }} nodeColor={(n) => `var(--${n.type})`} />}
        <Cursors peers={peers} />
      </ReactFlow>

      {selected && <Inspector key={selected.id} node={selected} issues={issuesByNode.get(selected.id) ?? []} />}
      {compileOpen && <CompileSheet wide={!selected} />}
    </div>
  );
}

export function GraphTab() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
