import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionMode,
  MarkerType,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Bot, StickyNote as NoteIcon, Clapperboard, Cloud, Command, FolderOpen, HardDrive, Image, Plug, Plus, Send, Server } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { addEdge, addNode, addNote, moveNode, removeEdges, removeNodes, setNoteField } from "../../board/ydoc";
import { resolveGraph } from "../../compile";
import type { GraphNode, MediaData, ModelData, ToolData } from "../../contracts/graph";
import { Sidebar, SidebarGroup } from "../shell/Sidebar";
import { BrandMark } from "../shell/TitleBar";
import { useBoard } from "../state/board";
import { latestRunByAgent, toolActivity, useApp } from "../state/store";
import { AgentFace } from "../ui";
import { CompileSheet } from "./CompileSheet";
import { Cursors } from "./Cursors";
import { newChannel, newId, newMaker, newModel, newTool } from "./defaults";
import { Inspector } from "./Inspector";
import { MakerIcon, makerService, nodeTypes, type FlowNode } from "./nodes";
import { freeSpot } from "./place";

const PAIRS = new Set(["agent:model", "model:agent", "agent:tool", "tool:agent", "agent:media", "media:agent", "agent:channel", "channel:agent", "agent:agent"]);
const MAKER_TOOLS: Record<string, MediaData["media"]> = { image_generate: "image", video_generate: "video" };

function DockItem({ tile, icon, label, onClick, testId }: { tile: string; icon: ReactNode; label: string; onClick: () => void; testId: string }) {
  return (
    <button className="dock-item" onClick={onClick} aria-label={label} data-testid={testId}>
      <span className={`tile ${tile}`}>{icon}</span>
      <span className="label">{label}</span>
    </button>
  );
}

function HarnessSidebar() {
  const { graph } = useBoard();
  const selected = useApp((s) => s.selectedNodeId);
  const select = useApp((s) => s.select);
  const runs = useApp((s) => s.runs);
  const flow = useReactFlow();
  const [q, setQ] = useState("");
  const latest = useMemo(() => latestRunByAgent(runs), [runs]);
  const hit = (n: GraphNode) => `${n.data.name} ${"displayName" in n.data ? n.data.displayName : ""} ${"label" in n.data ? n.data.label : ""}`.toLowerCase().includes(q.toLowerCase());
  const focus = (n: GraphNode) => {
    select(n.id);
    void flow.setCenter(n.position.x + 120, n.position.y + 60, { zoom: Math.max(flow.getZoom(), 0.9), duration: 500 });
  };
  const groups: [string, GraphNode[]][] = [
    ["Agents", graph.nodes.filter((n) => n.kind === "agent" && hit(n))],
    ["Models", graph.nodes.filter((n) => n.kind === "model" && hit(n))],
    ["Tools", graph.nodes.filter((n) => n.kind === "tool" && hit(n))],
    ["Makers", graph.nodes.filter((n) => n.kind === "media" && hit(n))],
    ["Chat apps", graph.nodes.filter((n) => n.kind === "channel" && hit(n))],
  ];
  return (
    <Sidebar title="Harness" search={q} onSearch={setQ} testId="harness-sidebar">
      {groups.map(([label, nodes]) => nodes.length > 0 && (
        <div key={label}>
          <SidebarGroup label={label} />
          {nodes.map((n) => (
            <button key={n.id} className="list-row" aria-selected={n.id === selected} onClick={() => focus(n)}>
              {n.kind === "agent" ? <AgentFace seed={n.data.name} size={28} status={latest.get(n.id)?.status} />
                : n.kind === "media" ? <span className="tile sm media"><MakerIcon media={n.data.media} size={13} /></span>
                : n.kind === "channel" ? <span className="tile sm channel"><Send size={12} /></span>
                : <span className={`tile sm ${n.kind === "tool" ? "tool" : (n.data as ModelData).endpoint === "local" ? "model" : "cloud"}`}>
                  {n.kind === "tool" ? ((n.data as ToolData).transport === "http" ? <Server size={13} /> : <Plug size={13} />) : (n.data as ModelData).endpoint === "local" ? <HardDrive size={13} /> : <Cloud size={13} />}
                </span>}
              <span className="grow">
                <span className="title ellipsis" style={{ display: "block" }}>{n.kind === "agent" ? n.data.displayName || n.data.name : ("label" in n.data && n.data.label) || n.data.name}</span>
                <span className="sub ellipsis mono" style={{ display: "block", fontSize: 11 }}>{n.kind === "model" ? (n.data as ModelData).model || "—" : n.kind === "media" ? makerService(n.data) || "—" : n.kind === "channel" ? `${n.data.allowedUsers.length} allowed` : n.data.name}</span>
              </span>
            </button>
          ))}
        </div>
      ))}
      {graph.nodes.length === 0 && <div className="faint" style={{ padding: "8px 10px" }}>Empty board.</div>}
    </Sidebar>
  );
}

function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <div className="welcome">
      <div className="inner pop-in">
        <BrandMark size={72} />
        <h2>Build your harness</h2>
        <p>Agents, the models they think with, the tools they use.</p>
        <div className="row" style={{ marginTop: 6 }}>
          <button className="btn light lg" onClick={onStart} data-testid="welcome-add-agent"><Plus size={15} /> Add an agent</button>
        </div>
      </div>
    </div>
  );
}

function Canvas() {
  const { graph, doc, peers, setCursor } = useBoard();
  const selectedNodeId = useApp((s) => s.selectedNodeId);
  const select = useApp((s) => s.select);
  const runs = useApp((s) => s.runs);
  const events = useApp((s) => s.events);
  const compileOpen = useApp((s) => s.compileOpen);
  const compileRes = useApp((s) => s.compile);
  const health = useApp((s) => s.health);
  const setPalette = useApp((s) => s.setPalette);
  const flow = useReactFlow();
  const wrap = useRef<HTMLDivElement>(null);

  const resolved = useMemo(() => resolveGraph(graph), [graph]);
  const issuesByNode = useMemo(() => {
    const m = new Map<string, typeof resolved.issues>();
    for (const i of resolved.issues) if (i.nodeId) m.set(i.nodeId, [...(m.get(i.nodeId) ?? []), i]);
    return m;
  }, [resolved]);
  const latest = useMemo(() => latestRunByAgent(runs), [runs]);
  const activity = useMemo(() => {
    const a = toolActivity(events, runs);
    // A maker is busy while its agent's running turn has an image/video call open.
    for (const r of Object.values(runs)) {
      if (r.status !== "running") continue;
      const open = new Map<string, number>();
      for (const e of events[r.runId] ?? []) {
        const kind = (e.type === "run.tool.started" || e.type === "run.tool.finished") ? MAKER_TOOLS[e.tool] : undefined;
        if (kind) open.set(kind, (open.get(kind) ?? 0) + (e.type === "run.tool.started" ? 1 : -1));
      }
      for (const e of graph.edges) {
        const other = graph.nodes.find((n) => n.id === (e.source === r.agentNodeId ? e.target : e.target === r.agentNodeId ? e.source : ""));
        if (other?.kind === "media" && (open.get(other.data.media) ?? 0) > 0) a.active.add(other.id);
      }
    }
    return a;
  }, [events, runs, graph]);
  const compiledProfiles = useMemo(() => new Set(compileRes?.ok ? compileRes.report.profiles.map((p) => p.name) : []), [compileRes]);
  const peerOnNode = useMemo(() => new Map(peers.filter((p) => p.selection).map((p) => [p.selection!, p])), [peers]);

  const [rfNodes, setRfNodes] = useState<FlowNode[]>([]);
  useEffect(() => {
    setRfNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      // Sticky notes ride along as their own node type, id "note:<id>".
      const notes = (graph.notes ?? []).map((n) => {
        const id = `note:${n.id}`;
        const p = old.get(id);
        return { id, type: "note", position: p?.dragging ? p.position : n.position, dragging: p?.dragging, measured: p?.measured, zIndex: -1, data: { note: n } } as unknown as FlowNode;
      });
      return [...notes, ...graph.nodes.map((n): FlowNode => {
        const p = old.get(n.id);
        const bundle = resolved.bundles.find((b) => b.agent.id === n.id);
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
            chain: bundle ? bundle.models.map((m) => (m.data as ModelData).model || m.data.name) : [],
            compiled: n.kind !== "agent" || compiledProfiles.has(String(n.data.name)) || !!run,
            active: activity.active.has(n.id),
            errored: activity.errored.has(n.id),
          },
        };
      })];
    });
  }, [graph, resolved, issuesByNode, latest, activity, compiledProfiles, peerOnNode, selectedNodeId]);

  const rfEdges = useMemo<Edge[]>(() => graph.edges.flatMap((e): Edge[] => {
    const s = graph.nodes.find((n) => n.id === e.source);
    const t = graph.nodes.find((n) => n.id === e.target);
    if (!s || !t) return [];
    // agent → agent: the source hands work to the target, as tasks.
    if (s.kind === "agent" && t.kind === "agent" && s.id !== t.id) return [{ id: e.id, source: s.id, target: t.id, sourceHandle: "down", targetHandle: "up", className: "handoff", markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 } }];
    const agent = s.kind === "agent" ? s : t.kind === "agent" ? t : null;
    const other = agent === s ? t : s;
    const running = agent ? latest.get(agent.id)?.status === "running" : false;
    if (agent && other.kind === "model") return [{ id: e.id, source: other.id, target: agent.id, sourceHandle: "out", targetHandle: "in", className: running ? "live" : undefined }];
    if (agent && (other.kind === "tool" || other.kind === "media" || other.kind === "channel")) return [{ id: e.id, source: agent.id, target: other.id, sourceHandle: "out", targetHandle: "in", className: activity.active.has(other.id) ? "live" : undefined }];
    return [{ id: e.id, source: e.source, target: e.target, className: "problem" }];
  }), [graph, latest, activity]);

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    setRfNodes((nds) => applyNodeChanges(changes, nds));
    const removed: string[] = [];
    for (const c of changes) {
      const note = c.type !== "add" && c.id.startsWith("note:") ? c.id.slice(5) : null;
      if (note) {
        if (c.type === "position" && c.position) setNoteField(doc, note, "position", { x: Math.round(c.position.x), y: Math.round(c.position.y) });
        // A note is deleted with its own button; Backspace in its text must not remove it.
        continue;
      }
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
    if (!PAIRS.has(`${kindOf(c.source)}:${kindOf(c.target)}`) || c.source === c.target) return false;
    // Two agents may hand work both ways (two edges); anything else connects once.
    const both = kindOf(c.source) === "agent" && kindOf(c.target) === "agent";
    return !graph.edges.some((e) => (e.source === c.source && e.target === c.target) || (!both && e.source === c.target && e.target === c.source));
  }, [graph, kindOf]);

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || !isValidConnection(c)) return;
    const agentId = kindOf(c.source) === "agent" ? c.source : c.target;
    const order = graph.edges.filter((e) => (e.source === agentId || e.target === agentId) && [e.source, e.target].some((id) => kindOf(id) === "model")).length;
    addEdge(doc, { id: newId("edge"), source: agentId, target: agentId === c.source ? c.target : c.source, order });
  }, [doc, graph, isValidConnection, kindOf]);

  const center = () => {
    const r = wrap.current?.getBoundingClientRect();
    return flow.screenToFlowPosition({ x: (r?.left ?? 0) + (r?.width ?? 800) / 2, y: (r?.top ?? 0) + (r?.height ?? 600) / 2 });
  };
  const place = (node: GraphNode) => {
    addNode(doc, node);
    select(node.id);
  };
  const add = (kind: GraphNode["kind"], make: (pos: { x: number; y: number }) => GraphNode) => place(make(freeSpot(graph, kind, center(), selectedNodeId)));

  const selected = graph.nodes.find((n) => n.id === selectedNodeId) ?? null;

  return (
    <div className="canvas" ref={wrap}
      onMouseMove={(e) => setCursor(flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }))}
      onMouseLeave={() => setCursor(null)}>

      {graph.nodes.length === 0 && <Welcome onStart={() => useApp.getState().setNewAgentOpen(true)} />}

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
        fitViewOptions={{ padding: 0.35, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
        deleteKeyCode={["Backspace", "Delete"]}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.1} color="rgba(255,255,255,0.075)" />
        <Controls position="bottom-left" showInteractive={false} />
        <Cursors peers={peers} />
      </ReactFlow>

      {graph.nodes.length > 0 && (
        <div className={`dock-wrap${selected ? " shifted" : ""}`}>
          <div className="dock glass" role="toolbar" aria-label="Add to the harness">
            <DockItem tile="agent" icon={<Bot size={20} />} label="New agent" testId="add-agent" onClick={() => useApp.getState().setNewAgentOpen(true)} />
            <div className="dock-sep" />
            <DockItem tile="model" icon={<HardDrive size={19} />} label="Local model" testId="add-model-local" onClick={() => add("model", (p) => newModel(graph, "local", p))} />
            <DockItem tile="cloud" icon={<Cloud size={19} />} label="Cloud model" testId="add-model-cloud" onClick={() => add("model", (p) => newModel(graph, "cloud", p))} />
            <div className="dock-sep" />
            <DockItem tile="tool" icon={<FolderOpen size={19} />} label="Files tool" testId="add-tool-files" onClick={() => add("tool", (p) => newTool(graph, "filesystem", p, health?.workspace ?? null))} />
            <DockItem tile="tool" icon={<Plug size={19} />} label="Add a tool" testId="add-tool" onClick={() => useApp.getState().setCatalogOpen(true)} />
            <div className="dock-sep" />
            <DockItem tile="media" icon={<Image size={19} />} label="Image maker" testId="add-maker-image" onClick={() => add("media", (p) => newMaker(graph, "image", p))} />
            <DockItem tile="media" icon={<Clapperboard size={19} />} label="Video maker" testId="add-maker-video" onClick={() => add("media", (p) => newMaker(graph, "video", p))} />
            <DockItem tile="channel" icon={<Send size={18} />} label="Telegram" testId="add-telegram" onClick={() => add("channel", (p) => newChannel(graph, "telegram", p))} />
            <div className="dock-sep" />
            <DockItem tile="note" icon={<NoteIcon size={19} />} label="Sticky note" testId="add-note" onClick={() => {
              const at = center();
              const id = newId("note");
              addNote(doc, { id, text: "", color: "yellow", position: { x: Math.round(at.x - 110), y: Math.round(at.y - 75) }, pinned: false, author: useApp.getState().identity.name, at: Date.now() });
              useApp.getState().setFreshNote(id);
            }} />
            <DockItem tile="file" icon={<Command size={19} />} label="Commands ⌘K" testId="dock-palette" onClick={() => setPalette(true)} />
          </div>
        </div>
      )}

      {selected && <Inspector key={selected.id} node={selected} issues={issuesByNode.get(selected.id) ?? []} />}
      {compileOpen && <CompileSheet wide={!selected} />}
    </div>
  );
}

export function GraphView() {
  return (
    <ReactFlowProvider>
      <HarnessSidebar />
      <section className="main">
        <div className="view page-enter">
          <Canvas />
        </div>
      </section>
    </ReactFlowProvider>
  );
}
