import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { Note } from "../../contracts/graph";
import { StickyNote } from "../notes/StickyNote";
import { Clapperboard, Cloud, HardDrive, Image, Plug, Send, Server } from "lucide-react";
import { memo } from "react";
import { CHANNEL_PLATFORMS, MEDIA_PROVIDERS, type AgentData, type ChannelData, type GraphNode, type MediaData, type ModelData, type ToolData } from "../../contracts/graph";
import type { RunSummary } from "../../contracts/run";
import { ago, usd } from "../lib/format";
import type { Peer } from "../state/board";
import { AgentFace } from "../ui";

export interface FlowNodeData extends Record<string, unknown> {
  node: GraphNode;
  hasError: boolean;
  peer: Peer | null;
  run: RunSummary | null;
  chain: string[];
  compiled: boolean;
  active: boolean;
  errored: boolean;
}

export type FlowNode = Node<FlowNodeData>;

function Peer({ peer }: { peer: Peer | null }) {
  if (!peer) return null;
  return (
    <>
      <div className="peer-ring" style={{ borderColor: peer.color }} />
      <div className="peer-tag" style={{ background: peer.color }}>{peer.name}</div>
    </>
  );
}

function status(run: RunSummary | null, compiled: boolean): { dot: string; text: string; cost: string } {
  const cost = run && (run.reportedUsd || run.estimatedUsd) ? usd(run.reportedUsd || run.estimatedUsd) : "";
  if (!run) return { dot: compiled ? "" : "warn", text: compiled ? "Ready" : "Not compiled", cost: "" };
  if (run.status === "running") return { dot: "run", text: "Working…", cost: "" };
  if (run.status === "succeeded") return { dot: "ok", text: ago(run.finishedAt ?? run.startedAt), cost };
  if (run.status === "interrupted") return { dot: "warn", text: "Stopped", cost };
  return { dot: "fail", text: "Failed", cost };
}

export const AgentNodeView = memo(function AgentNodeView({ data }: NodeProps<FlowNode>) {
  const a = data.node.data as AgentData;
  const s = status(data.run, data.compiled);
  return (
    <div className={`node node-agent${data.hasError ? " has-error" : ""}${data.run?.status === "running" ? " running" : ""}`}>
      <Peer peer={data.peer} />
      <Handle type="target" position={Position.Left} id="in" />
      <div className="head">
        <AgentFace seed={a.name} size={44} status={data.run?.status} />
        <div className="grow">
          <div className="name ellipsis">{a.displayName || a.name}</div>
          <div className="meta" style={{ marginTop: 5 }}>
            <span className="chip mono">{data.chain[0] ?? "no model"}</span>
            {data.chain.length > 1 && <span className="chip">+{data.chain.length - 1}</span>}
          </div>
        </div>
      </div>
      <div className="foot">
        <span className={`dot ${s.dot}`} />
        <span className="grow ellipsis">{s.text}</span>
        {s.cost && <span className="num">{s.cost}</span>}
      </div>
      <Handle type="source" position={Position.Right} id="out" />
      {/* Hand-offs run top to bottom: drag from an agent's bottom to the agent it gives work to. */}
      <Handle type="source" position={Position.Bottom} id="down" className="handoff-handle" />
      <Handle type="target" position={Position.Top} id="up" className="handoff-handle" />
    </div>
  );
});

export const ModelNodeView = memo(function ModelNodeView({ data }: NodeProps<FlowNode>) {
  const m = data.node.data as ModelData;
  return (
    <div className={`node node-compact${data.hasError ? " has-error" : ""}`}>
      <Peer peer={data.peer} />
      <div className={`tile ${m.endpoint === "local" ? "model" : "cloud"}`}>{m.endpoint === "local" ? <HardDrive size={16} /> : <Cloud size={16} />}</div>
      <div className="grow">
        <div className="label ellipsis">{m.label || m.name}</div>
        <div className="sub ellipsis">{m.model || "set a model"}</div>
      </div>
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  );
});

export const ToolNodeView = memo(function ToolNodeView({ data }: NodeProps<FlowNode>) {
  const t = data.node.data as ToolData;
  return (
    <div className={`node node-compact${data.hasError ? " has-error" : ""}${data.active ? " calling" : ""}`}>
      <Peer peer={data.peer} />
      <Handle type="target" position={Position.Left} id="in" />
      <div className="tile tool">{t.transport === "http" ? <Server size={16} /> : <Plug size={16} />}</div>
      <div className="grow">
        <div className="label ellipsis">{t.label || t.name}</div>
        <div className="sub ellipsis">{data.active ? "calling…" : data.errored ? "last call failed" : t.name}</div>
      </div>
      {data.errored && !data.active && <span className="dot fail" />}
    </div>
  );
});

/** The service a maker uses, by its label; "" when none is picked. */
export function makerService(m: MediaData): string {
  return (MEDIA_PROVIDERS[m.media] as Record<string, { label: string } | undefined>)[m.provider]?.label ?? "";
}

export function MakerIcon({ media, size }: { media: MediaData["media"]; size: number }) {
  return media === "video" ? <Clapperboard size={size} /> : <Image size={size} />;
}

export const MediaNodeView = memo(function MediaNodeView({ data }: NodeProps<FlowNode>) {
  const m = data.node.data as MediaData;
  const service = makerService(m);
  return (
    <div className={`node node-compact${data.hasError ? " has-error" : ""}${data.active ? " calling" : ""}`}>
      <Peer peer={data.peer} />
      <Handle type="target" position={Position.Left} id="in" />
      <div className="tile media"><MakerIcon media={m.media} size={16} /></div>
      <div className="grow">
        <div className="label ellipsis">{m.label || (m.media === "video" ? "Videos" : "Images")}</div>
        <div className="sub ellipsis">{data.active ? "making…" : service ? [service, m.model].filter(Boolean).join(" · ") : "pick a service"}</div>
      </div>
    </div>
  );
});

export const ChannelNodeView = memo(function ChannelNodeView({ data }: NodeProps<FlowNode>) {
  const c = data.node.data as ChannelData;
  const n = c.allowedUsers.length;
  return (
    <div className={`node node-compact${data.hasError ? " has-error" : ""}`}>
      <Peer peer={data.peer} />
      <Handle type="target" position={Position.Left} id="in" />
      <div className="tile channel"><Send size={15} /></div>
      <div className="grow">
        <div className="label ellipsis">{c.label || CHANNEL_PLATFORMS[c.platform].label}</div>
        <div className="sub ellipsis">{n ? `${n} allowed` : "nobody allowed yet"}</div>
      </div>
    </div>
  );
});

/** A sticky note on the canvas (not part of the harness: never compiled). */
export const NoteNodeView = memo(function NoteNodeView({ data }: NodeProps<Node<{ note: Note }>>) {
  return <StickyNote note={data.note} canvas />;
});

export const nodeTypes = { note: NoteNodeView, agent: AgentNodeView, model: ModelNodeView, tool: ToolNodeView, media: MediaNodeView, channel: ChannelNodeView };
