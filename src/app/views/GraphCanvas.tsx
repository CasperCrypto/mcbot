import { Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, useStore, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { memo, useEffect, useMemo, type ReactNode } from "react";

export interface GNode {
  id: string;
  x: number;
  y: number;
  content: ReactNode;
  className?: string;
}

export interface GEdge {
  id: string;
  source: string;
  target: string;
  live?: boolean;
}

type Dir = "LR" | "TB";
type GData = { content: ReactNode; className?: string; dir: Dir };

const GNodeView = memo(function GNodeView({ data }: NodeProps<Node<GData>>) {
  const vertical = data.dir === "TB";
  return (
    <>
      <Handle type="target" position={vertical ? Position.Top : Position.Left} isConnectable={false} style={{ opacity: 0 }} />
      <div className={`gnode ${data.className ?? ""}`}>{data.content}</div>
      <Handle type="source" position={vertical ? Position.Bottom : Position.Right} isConnectable={false} style={{ opacity: 0 }} />
    </>
  );
});
const nodeTypes = { g: GNodeView };

/** Refit when the content changes and when the canvas itself is resized (a side panel opening, the window). */
function Fit({ signature }: { signature: string }) {
  const flow = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  useEffect(() => {
    const t = setTimeout(() => void flow.fitView({ padding: 0.14, maxZoom: 1.15, duration: 350 }), 140);
    return () => clearTimeout(t);
  }, [signature, width, height, flow]);
  return null;
}

/** A read-only graph for structure that is not edited on the board: runs, memory, folders. */
export function GraphCanvas({ nodes, edges, dir = "LR", selected, onSelect, fitSignature }: {
  nodes: GNode[];
  edges: GEdge[];
  dir?: Dir;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  /** Refit the view when this changes (not on every live update). */
  fitSignature: string;
}) {
  const rfNodes = useMemo<Node<GData>[]>(() => nodes.map((n) => ({
    id: n.id, type: "g", position: { x: n.x, y: n.y }, selected: n.id === selected, draggable: false, connectable: false,
    data: { content: n.content, className: n.className, dir },
  })), [nodes, selected, dir]);
  const rfEdges = useMemo<Edge[]>(() => edges.map((e) => ({ id: e.id, source: e.source, target: e.target, className: e.live ? "live" : undefined, selectable: false })), [edges]);
  return (
    <div className="canvas">
      <ReactFlowProvider>
        <ReactFlow
          nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} colorMode="dark" fitView fitViewOptions={{ padding: 0.14, maxZoom: 1.15 }}
          minZoom={0.15} maxZoom={1.6} nodesDraggable={false} nodesConnectable={false} elementsSelectable
          onNodeClick={(_, n) => onSelect?.(n.id)} onPaneClick={() => onSelect?.(null)} deleteKeyCode={null}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.1} color="rgba(255,255,255,0.075)" />
          <Controls position="bottom-left" showInteractive={false} />
          <Fit signature={fitSignature} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
