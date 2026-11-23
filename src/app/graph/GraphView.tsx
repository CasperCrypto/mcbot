import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionMode,
  MarkerType,
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
import { Bot, Sparkles, StickyNote as NoteIcon, Clapperboard, Cloud, Command, FileCode2, FolderOpen, HardDrive, Image, Plug, Plus, Send, Server } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { addEdge, addNode, addNote, moveNode, removeEdges, removeNodes, setFrameField, setNoteField } from "../../board/ydoc";
import { resolveGraph } from "../../compile";
import type { GraphNode, MediaData, ModelData, ToolData } from "../../contracts/graph";
import { Sidebar, SidebarGroup } from "../shell/Sidebar";
import { BrandMark } from "../shell/TitleBar";
import { useBoard } from "../state/board";
import { latestRunByAgent, toolActivity, useApp } from "../state/store";
import { AgentFace } from "../ui";
import { CompileSheet } from "./CompileSheet";
import { Cursors } from "./Cursors";
import { HermesView } from "./HermesView";
import { LayersView } from "./LayersView";
import { duplicateNode, newChannel, newId, newMaker, newModel, newTool } from "./defaults";
import { ContextMenu, type MenuAt } from "./ContextMenu";
import { Inspector } from "./Inspector";
import { LiveFiles } from "./LiveFiles";
import { useLingering, usePresence } from "../lib/presence";
import { LogoTile, nodeLogo } from "./Logo";
import { MakerIcon, makerService, nodeTypes, type FlowNode } from "./nodes";
import { FrameNodeView } from "./FrameNode";
import { freeSpot, noteSpot } from "./place";

/** React Flow (MIT) is credited in the About screen's notices; its corner badge is not part of the board. */
const PRO = { hideAttribution: true } as const;
/** Blocks, notes and frames (frames are areas behind the blocks: FrameNode.tsx). */
const TYPES = { ...nodeTypes, frame: FrameNodeView };
/** Half the dot grid: blocks land in line with each other. */
const SNAP: [number, number] = [11, 11];
const MINI: Record<string, string> = { agent: "var(--k-agent)", model: "var(--k-model)", tool: "var(--k-tool)", media: "var(--k-media, var(--k-tool))", channel: "var(--k-channel, var(--k-tool))", note: "var(--note-yellow, var(--text-4))" };
const miniColor = (n: { type?: string }) => MINI[n.type ?? ""] ?? "var(--text-4)";

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
                : n.kind === "media" ? <LogoTile sm logo={nodeLogo(n)} kind="media"><MakerIcon media={n.data.media} size={13} /></LogoTile>
                : n.kind === "channel" ? <LogoTile sm logo={nodeLogo(n)} kind="channel"><Send size={12} /></LogoTile>
                : <LogoTile sm logo={nodeLogo(n)} kind={n.kind === "tool" ? "tool" : (n.data as ModelData).endpoint === "local" ? "model" : "cloud"}>
                  {n.kind === "tool" ? ((n.data as ToolData).transport === "http" ? <Server size={13} /> : <Plug size={13} />) : (n.data as ModelData).endpoint === "local" ? <HardDrive size={13} /> : <Cloud size={13} />}
                </LogoTile>}
              <span className="grow">
                <span className="title ellipsis" style={{ display: "block" }}>{n.kind === "agent" ? n.data.displayName || n.data.name : ("label" in n.data && n.data.label) || n.data.name}</span>
                <span className="sub ellipsis mono" style={{ display: "block", fontSize: 12 }}>{n.kind === "model" ? (n.data as ModelData).model || "—" : n.kind === "media" ? makerService(n.data) || "—" : n.kind === "channel" ? `${n.data.allowedUsers.length} allowed` : n.data.name}</span>
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
          <button className="btn light lg" onClick={() => useApp.getState().setBuilder(true)} data-testid="welcome-builder"><Sparkles size={15} /> Describe it to McBot</button>
          <button className="btn lg" onClick={() => useApp.getState().setTeamsOpen(true)} data-testid="welcome-team">Start with a team</button>
          <button className="btn lg" onClick={onStart} data-testid="welcome-add-agent"><Plus size={15} /> Add an agent</button>
        </div>
      </div>
    </div>
  );
}

function Canvas() {
  const { graph, doc, peers, setCursor } = useBoard();
  const theme = useApp((s) => s.theme);
  const selectedNodeId = useApp((s) => s.selectedNodeId);
  const select = useApp((s) => s.select);
  const runs = useApp((s) => s.runs);
  const events = useApp((s) => s.events);
  const compileOpen = useApp((s) => s.compileOpen);
  const compileRes = useApp((s) => s.compile);
  const health = useApp((s) => s.health);
  const setPalette = useApp((s) => s.setPalette);
  const liveOpen = useApp((s) => s.liveFilesOpen);
  const drift = useApp((s) => s.drift);
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
  // Files on disk come from the background dry-run compile, so an agent compiled in an earlier
  // session reads "Ready", not "Not compiled". Until that answers, the last compile here counts.
  const onDisk = useApp((s) => s.onDisk);
  const compiledProfiles = useMemo(() => {
    if (onDisk) return new Map(Object.entries(onDisk));
    return new Map((compileRes?.ok ? compileRes.report.profiles : []).map((p) => [p.name, "fresh" as const]));
  }, [onDisk, compileRes]);
  const peerOnNode = useMemo(() => new Map(peers.filter((p) => p.selection).map((p) => [p.selection!, p])), [peers]);

  const [rfNodes, setRfNodes] = useState<FlowNode[]>([]);
  const lastSelected = useRef<string | null>(null);
  useEffect(() => {
    const external = lastSelected.current !== selectedNodeId;
    lastSelected.current = selectedNodeId;
    setRfNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      // Sticky notes ride along as their own node type, id "note:<id>".
      const notes = (graph.notes ?? []).map((n) => {
        const id = `note:${n.id}`;
        const p = old.get(id);
        return { id, type: "note", position: p?.dragging ? p.position : n.position, dragging: p?.dragging, measured: p?.measured, zIndex: -1, data: { note: n } } as unknown as FlowNode;
      });
      // Frames sit behind everything, id "frame:<id>", dragged by their title strip.
      const frames = (graph.frames ?? []).map((f) => {
        const id = `frame:${f.id}`;
        const p = old.get(id);
        const resizing = !!(p as { resizing?: boolean } | undefined)?.resizing;
        return {
          id, type: "frame", position: p?.dragging || resizing ? p!.position : f.position, dragging: p?.dragging, measured: p?.measured, selected: p?.selected,
          width: resizing ? p!.width : f.size.width, height: resizing ? p!.height : f.size.height, zIndex: -2, dragHandle: ".frame-head", data: { frame: f },
        } as unknown as FlowNode;
      });
      return [...frames, ...notes, ...graph.nodes.map((n): FlowNode => {
        const p = old.get(n.id);
        const bundle = resolved.bundles.find((b) => b.agent.id === n.id);
        const run = n.kind === "agent" ? latest.get(n.id) ?? null : null;
        return {
          id: n.id,
          type: n.kind,
          position: p?.dragging ? p.position : n.position,
          // Several blocks picked on the canvas (Shift-drag a box, ⌘-click) stay picked while the board changes.
          selected: external || !p ? n.id === selectedNodeId : !!p.selected || n.id === selectedNodeId,
          dragging: p?.dragging,
          measured: p?.measured,
          data: {
            node: n,
            hasError: (issuesByNode.get(n.id) ?? []).some((i) => i.level === "error"),
            peer: peerOnNode.get(n.id) ?? null,
            run,
            chain: bundle ? bundle.models.map((m) => (m.data as ModelData).model || m.data.name) : [],
            compiled: n.kind !== "agent" ? "fresh" : compiledProfiles.get(String(n.data.name)) ?? (run ? "fresh" : "none"),
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
    // A selected block's wires say what they mean (thinks with, uses, talks on…); the rest stay quiet.
    const said = (text: string) => (e.source === selectedNodeId || e.target === selectedNodeId ? { label: text, labelBgPadding: [7, 3] as [number, number], labelBgBorderRadius: 7 } : {});
    // agent → agent: the source hands work to the target, as tasks.
    if (s.kind === "agent" && t.kind === "agent" && s.id !== t.id) return [{ id: e.id, source: s.id, target: t.id, sourceHandle: "down", targetHandle: "up", className: "handoff", markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 }, ...said("hands work to") }];
    const agent = s.kind === "agent" ? s : t.kind === "agent" ? t : null;
    const other = agent === s ? t : s;
    const running = agent ? latest.get(agent.id)?.status === "running" : false;
    if (agent && other.kind === "model") return [{ id: e.id, source: other.id, target: agent.id, sourceHandle: "out", targetHandle: "in", className: running ? "live" : undefined, ...said(e.order > 0 ? "falls back to" : "thinks with") }];
    if (agent && (other.kind === "tool" || other.kind === "media" || other.kind === "channel")) {
      const verb = other.kind === "tool" ? "uses" : other.kind === "channel" ? "talks on" : (other.data as MediaData).media === "video" ? "makes videos with" : "makes images with";
      return [{ id: e.id, source: agent.id, target: other.id, sourceHandle: "out", targetHandle: "in", className: activity.active.has(other.id) ? "live" : undefined, ...said(verb) }];
    }
    return [{ id: e.id, source: e.source, target: e.target, className: "problem" }];
  }), [graph, latest, activity, selectedNodeId]);

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    setRfNodes((nds) => applyNodeChanges(changes, nds));
    const removed: string[] = [];
    for (const c of changes) {
      if (c.type !== "add" && c.id.startsWith("frame:")) {
        // A frame moves by its title strip; its own button removes it (never Backspace); resizing saves on release.
        if (c.type === "position" && c.position && c.dragging) setFrameField(doc, c.id.slice(6), "position", { x: Math.round(c.position.x), y: Math.round(c.position.y) });
        continue;
      }
      const note = c.type !== "add" && c.id.startsWith("note:") ? c.id.slice(5) : null;
      if (note) {
        if (c.type === "position" && c.position) setNoteField(doc, note, "position", { x: Math.round(c.position.x), y: Math.round(c.position.y) });
        // A note is deleted with its own button; Backspace in its text must not remove it.
        continue;
      }
      if (c.type === "position" && c.position) moveNode(doc, c.id, c.position);
      if (c.type === "remove") removed.push(c.id);
      if (c.type === "select" && c.selected) {
        lastSelected.current = c.id; // picked on the canvas: keep the rest of a multi-selection
        select(c.id);
      }
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

  // While a connection is being drawn, blocks it cannot reach dim; dropping on one says why.
  const [connecting, setConnecting] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const onConnectStart = useCallback((_: unknown, p: { nodeId: string | null }) => { setConnecting(kindOf(p.nodeId) ?? null); setConnectFrom(p.nodeId); }, [kindOf]);
  const onConnectEnd = useCallback((_: unknown, state: { isValid: boolean | null; fromNode: { id: string } | null; toNode: { id: string } | null }) => {
    setConnecting(null);
    setConnectFrom(null);
    const from = kindOf(state.fromNode?.id ?? null);
    const to = kindOf(state.toNode?.id ?? null);
    if (!from || !to || state.isValid || state.fromNode?.id === state.toNode?.id) return;
    const word = (k: string) => (k === "media" ? "a maker" : k === "channel" ? "a chat app" : k === "tool" ? "a tool" : k === "model" ? "a model" : "an agent");
    useApp.getState().toast({
      kind: "fail",
      text: from !== "agent" && to !== "agent"
        ? `${word(from)[0]!.toUpperCase()}${word(from).slice(1)} can't connect to ${word(to)}: in Hermes both belong to an agent. Wire each to the agent; it uses them together.`
        : "Already connected.",
    });
  }, [kindOf]);

  // Dragging a frame carries what sits inside it: the blocks and notes whose centre is in the frame
  // when the drag starts.
  const rfRef = useRef<FlowNode[]>([]);
  rfRef.current = rfNodes;
  const frameDrag = useRef<{ id: string; start: { x: number; y: number }; members: Map<string, { x: number; y: number }> } | null>(null);
  const onNodeDragStart = useCallback((_: unknown, n: FlowNode) => {
    frameDrag.current = null;
    if (!n.id.startsWith("frame:")) return;
    const f = (graph.frames ?? []).find((x) => `frame:${x.id}` === n.id);
    if (!f) return;
    const members = new Map<string, { x: number; y: number }>();
    for (const m of rfRef.current) {
      if (m.id.startsWith("frame:")) continue;
      const w = m.measured?.width ?? 200, h = m.measured?.height ?? 80;
      const cx = m.position.x + w / 2, cy = m.position.y + h / 2;
      if (cx > f.position.x && cx < f.position.x + f.size.width && cy > f.position.y && cy < f.position.y + f.size.height) members.set(m.id, { ...m.position });
    }
    frameDrag.current = { id: n.id, start: { ...n.position }, members };
  }, [graph]);
  const onNodeDrag = useCallback((_: unknown, n: FlowNode) => {
    const d = frameDrag.current;
    if (!d || d.id !== n.id || !d.members.size) return;
    const dx = n.position.x - d.start.x, dy = n.position.y - d.start.y;
    setRfNodes((nds) => nds.map((x) => { const p = d.members.get(x.id); return p ? { ...x, position: { x: p.x + dx, y: p.y + dy } } : x; }));
    for (const [id, p] of d.members) {
      const at = { x: Math.round(p.x + dx), y: Math.round(p.y + dy) };
      if (id.startsWith("note:")) setNoteField(doc, id.slice(5), "position", at);
      else moveNode(doc, id, at);
    }
  }, [doc]);
  const onNodeDragStop = useCallback(() => { frameDrag.current = null; }, []);

  // Right-click: add a block where you clicked, or a block's own actions (ContextMenu.tsx).
  const [menu, setMenu] = useState<MenuAt | null>(null);
  // Building with the keyboard: Tab / ⇧Tab walk the blocks (the focused one is selected, its
  // inspector opens), arrows nudge it (React Flow), F2 or Enter names it, ⌘D duplicates it.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const onFocus = (e: FocusEvent) => {
      const node = (e.target as HTMLElement | null)?.closest?.(".react-flow__node") as HTMLElement | null;
      const id = node?.dataset.id;
      if (!id || id.startsWith("note:") || !node!.matches(":focus-visible")) return;
      if (useApp.getState().selectedNodeId !== id) select(id);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "F2" && e.key !== "Enter") return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, button, [contenteditable='true']") && !t.closest(".react-flow__node")) return;
      const title = document.querySelector<HTMLInputElement>('[data-testid="inspector-title"]');
      if (!title || !useApp.getState().selectedNodeId) return;
      e.preventDefault();
      title.focus();
      title.select();
    };
    el.addEventListener("focusin", onFocus);
    el.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("focusin", onFocus);
      el.removeEventListener("keydown", onKey);
    };
  }, [select]);

  // ⌘D duplicates the selected block beside it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "d" || (e.target as HTMLElement | null)?.closest("input, textarea, [contenteditable='true'], .monaco-editor")) return;
      const node = graph.nodes.find((n) => n.id === useApp.getState().selectedNodeId);
      if (!node) return;
      e.preventDefault();
      const copy = duplicateNode(graph, node);
      addNode(doc, copy);
      select(copy.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [graph, doc, select]);

  // Fit the whole board into the room left beside the live files panel (⌘0, and when it opens or closes).
  const fit = useCallback(() => void flow.fitView({ padding: liveOpen ? { left: "470px", top: "70px", right: "50px", bottom: "110px" } : 0.25, maxZoom: 1, duration: 400 }), [flow, liveOpen]);
  // A team or a plan just joined the board: show all of it once its blocks have rendered.
  const fitRequest = useApp((s) => s.fitRequest);
  useEffect(() => {
    if (!fitRequest) return;
    // The inspector opens on the new lead: leave it room on the right.
    const t = setTimeout(() => void flow.fitView({ padding: { left: "60px", top: "80px", right: useApp.getState().selectedNodeId ? "440px" : "60px", bottom: "120px" }, maxZoom: 1, duration: 400 }), 250);
    return () => clearTimeout(t);
  }, [fitRequest]); // eslint-disable-line react-hooks/exhaustive-deps
  const firstFit = useRef(true);
  useEffect(() => {
    if (firstFit.current) { firstFit.current = false; if (!liveOpen) return; }
    const t = setTimeout(fit, 60);
    return () => clearTimeout(t);
  }, [liveOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "0" && !(e.target as HTMLElement | null)?.closest("input, textarea, .monaco-editor")) {
        e.preventDefault();
        fit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fit]);

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
  // The dock shrinks to fit beside the inspector or live files instead of running off the board.
  const dockRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const wrap = dockRef.current;
    const board = wrap?.parentElement;
    if (!wrap || !board) return;
    const fit = () => {
      const css = getComputedStyle(document.documentElement);
      const side = (selected ? parseFloat(css.getPropertyValue("--inspector-w")) + 20 : 0) + (liveOpen ? parseFloat(css.getPropertyValue("--live-w")) + 10 : 0);
      const room = board.clientWidth - side - 32;
      const need = (wrap.firstElementChild as HTMLElement | null)?.scrollWidth ?? 0;
      wrap.style.setProperty("--dock-fit", need > room && room > 0 ? String(Math.max(0.6, room / need)) : "1");
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(board);
    return () => ro.disconnect();
  }, [selected, liveOpen, graph.nodes.length > 0]);
  // Panels leave the way they came (lib/presence.ts): the inspector keeps showing its block while it goes.
  const inspecting = useLingering(selected);
  const live = usePresence(liveOpen && graph.nodes.length > 0);
  const compiling = usePresence(compileOpen);

  return (
    <div className="canvas" ref={wrap} data-connecting={connecting ?? undefined}
      onMouseMove={(e) => setCursor(flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }))}
      onMouseLeave={() => setCursor(null)}>

      {connectFrom && <style>{`.canvas .react-flow__node[data-id="${CSS.escape(connectFrom)}"] { opacity: 1 !important; }`}</style>}
      {graph.nodes.length === 0 && <Welcome onStart={() => useApp.getState().setNewAgentOpen(true)} />}

      <ReactFlow
        proOptions={PRO}
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStart={onNodeDragStart as never}
        onNodeDrag={onNodeDrag as never}
        onNodeDragStop={onNodeDragStop}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd as never}
        isValidConnection={isValidConnection}
        connectionMode={ConnectionMode.Loose}
        onPaneClick={() => { select(null); setMenu(null); }}
        onPaneContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, flow: flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }), nodeId: null }); }}
        onSelectionContextMenu={(e, ns) => { e.preventDefault(); const first = ns.find((n) => !n.id.startsWith("frame:") && !n.id.startsWith("note:")); if (first) setMenu({ x: e.clientX, y: e.clientY, flow: first.position, nodeId: first.id }); }}
        onNodeContextMenu={(e, n) => { e.preventDefault(); if (n.id.startsWith("note:") || n.id.startsWith("frame:")) return; if (!n.selected) { lastSelected.current = null; select(n.id); } setMenu({ x: e.clientX, y: e.clientY, flow: n.position, nodeId: n.id }); }}
        fitView
        fitViewOptions={{ padding: 0.35, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
        deleteKeyCode={["Backspace", "Delete"]}
        snapToGrid
        snapGrid={SNAP}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={["Meta", "Control"]}
        colorMode={theme}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.1} color="var(--grid-dot)" />
        <Controls position="bottom-left" showInteractive={false} />
        {graph.nodes.length >= 8 && !selected && <MiniMap position="bottom-right" pannable zoomable className="minimap" nodeBorderRadius={6} nodeColor={miniColor} />}
        <Cursors peers={peers} />
      </ReactFlow>

      {graph.nodes.length > 0 && (
        <div ref={dockRef} className={`dock-wrap${selected ? " shifted" : ""}${liveOpen ? " with-live" : ""}`}>
          <div className="dock glass" role="toolbar" aria-label="Add to the harness">
            <DockItem tile="agent" icon={<Sparkles size={19} />} label="Ask McBot to build" testId="add-builder" onClick={() => useApp.getState().setBuilder(true)} />
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
            <DockItem tile="channel" icon={<Send size={18} />} label="Chat app" testId="add-chat-app" onClick={() => useApp.getState().setChatAppsOpen(true)} />
            <div className="dock-sep" />
            <DockItem tile="note" icon={<NoteIcon size={19} />} label="Sticky note" testId="add-note" onClick={() => {
              const id = newId("note");
              addNote(doc, { id, text: "", color: "yellow", position: noteSpot(graph, center()), pinned: false, author: useApp.getState().identity.name, at: Date.now() });
              useApp.getState().setFreshNote(id);
            }} />
            <DockItem tile="file" icon={<Command size={19} />} label="Commands ⌘K" testId="dock-palette" onClick={() => setPalette(true)} />
          </div>
        </div>
      )}

      {graph.nodes.length > 0 && !liveOpen && (
        <button className="live-toggle glass" onClick={() => useApp.getState().setLiveFilesOpen(true)} data-testid="live-files-open" data-tip="The files this board writes, live" data-tip-side="right">
          <FileCode2 size={13} /> Files{drift ? <span className="chip warn">{drift}</span> : null}
        </button>
      )}
      {menu && <ContextMenu at={menu} onClose={() => setMenu(null)} onFit={fit} selection={rfNodes
        .filter((n) => !n.id.startsWith("frame:") && (n.selected || n.id === menu.nodeId))
        .map((n) => ({ x: n.position.x, y: n.position.y, width: n.measured?.width ?? 200, height: n.measured?.height ?? 80 }))} />}
      {live.mounted && <LiveFiles closing={live.closing} onClose={() => useApp.getState().setLiveFilesOpen(false)} />}
      {inspecting.value && <Inspector key={inspecting.value.id} node={inspecting.value} closing={inspecting.closing} issues={issuesByNode.get(inspecting.value.id) ?? []} />}
      {compiling.mounted && <CompileSheet wide={!selected} closing={compiling.closing} />}
    </div>
  );
}

export function GraphView() {
  // Board: the parts you edit. Hermes: the whole harness behind them; a click on a part opens the
  // block that makes it, on the Board.
  const [mode, setMode] = useState<"board" | "layers" | "hermes">("board");
  return (
    <ReactFlowProvider>
      <HarnessSidebar />
      <section className="main">
        <div className="view page-enter">
          <div className="seg-float" role="tablist" aria-label="View">
            <button role="tab" aria-selected={mode === "board"} onClick={() => setMode("board")} data-testid="mode-board">Board</button>
            <button role="tab" aria-selected={mode === "layers"} onClick={() => setMode("layers")} data-testid="mode-layers" data-tip="Each agent's harness, layer by layer" data-tip-side="bottom">Layers</button>
            <button role="tab" aria-selected={mode === "hermes"} onClick={() => setMode("hermes")} data-testid="mode-hermes" data-tip="Everything Hermes runs, live. Click a part to change it" data-tip-side="bottom">Hermes</button>
          </div>
          {mode === "board" ? <Canvas />
            : mode === "layers" ? <LayersView onEdit={(nodeId) => { setMode("board"); useApp.getState().select(nodeId); }} />
            : <HermesView onEdit={(nodeId) => { setMode("board"); useApp.getState().select(nodeId); }} />}
        </div>
      </section>
    </ReactFlowProvider>
  );
}
