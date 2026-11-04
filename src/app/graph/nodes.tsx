import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Bot, Cloud, Cpu, HardDrive, Plug } from "lucide-react";
import { memo, type CSSProperties } from "react";
import type { AgentData, GraphNode, ModelData, ToolData } from "../../contracts/graph";
import type { RunSummary } from "../../contracts/run";
import { ago, usd } from "../lib/format";
import type { Peer } from "../state/board";

export interface FlowNodeData extends Record<string, unknown> {
  node: GraphNode;
  hasError: boolean;
  peer: Peer | null;
  /** agent: latest run */
  run: RunSummary | null;
  /** agent: resolved model chain labels */
  chain: string[];
  tools: number;
  compiled: boolean;
  /** tool: a call is in flight / last call errored */
  active: boolean;
  errored: boolean;
}

export type FlowNode = Node<FlowNodeData>;

function PeerRing({ peer }: { peer: Peer | null }) {
  if (!peer) return null;
  return (
    <>
      <div className="peer-ring" style={{ "--peer": peer.color } as CSSProperties} />
      <div className="peer-tag" style={{ "--peer": peer.color } as CSSProperties}>{peer.name}</div>
    </>
  );
}

function statusDot(run: RunSummary | null): { cls: string; text: string } {
  if (!run) return { cls: "", text: "Not run yet" };
  if (run.status === "running") return { cls: "run", text: "Running…" };
  const cost = run.reportedUsd || run.estimatedUsd ? ` · ${usd(run.reportedUsd || run.estimatedUsd)}` : "";
  if (run.status === "succeeded") return { cls: "ok", text: `Ran ${ago(run.finishedAt ?? run.startedAt)}${cost}` };
  if (run.status === "interrupted") return { cls: "warn", text: "Interrupted" };
  return { cls: "fail", text: `Failed ${ago(run.finishedAt ?? run.startedAt)}` };
}

export const AgentNodeView = memo(function AgentNodeView({ data }: NodeProps<FlowNode>) {
  const a = data.node.data as AgentData;
  const status = statusDot(data.run);
  return (
    <div className={`node${data.hasError ? " has-error" : ""}${data.run?.status === "running" ? " running" : ""}`}>
      <PeerRing peer={data.peer} />
      <Handle type="target" position={Position.Left} id="in" />
      <div className="node-head">
        <div className="node-glyph agent"><Bot size={15} strokeWidth={2} /></div>
        <div className="node-title">
          <b>{a.displayName || a.name}</b>
          <small className="mono">hermes -p {a.name || "…"}</small>
        </div>
      </div>
      <div className="node-body">
        <div className="node-meta">
          <Cpu size={12} />
          <span className="mono">{data.chain[0] ?? "no model"}</span>
          {data.chain.length > 1 && <span className="badge">+{data.chain.length - 1} fallback</span>}
        </div>
        <div className="node-meta">
          <Plug size={12} />
          <span>{data.tools} tool{data.tools === 1 ? "" : "s"}</span>
          <span className="faint">·</span>
          <span>{a.skills.length} skill{a.skills.length === 1 ? "" : "s"}</span>
        </div>
      </div>
      <div className="node-foot">
        <span className={`dot ${status.cls}`} />
        <span className="grow">{status.text}</span>
        {!data.compiled && <span className="badge warn">not compiled</span>}
      </div>
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  );
});

export const ModelNodeView = memo(function ModelNodeView({ data }: NodeProps<FlowNode>) {
  const m = data.node.data as ModelData;
  let host = m.baseUrl;
  try {
    host = new URL(m.baseUrl).host;
  } catch {
    /* show the raw value while it is being typed */
  }
  return (
    <div className={`node${data.hasError ? " has-error" : ""}`}>
      <PeerRing peer={data.peer} />
      <div className="node-head">
        <div className="node-glyph model">{m.endpoint === "local" ? <HardDrive size={15} /> : <Cloud size={15} />}</div>
        <div className="node-title">
          <b>{m.label || m.name}</b>
          <small>{m.endpoint === "local" ? "Local · OpenAI-compatible" : "Cloud · OpenAI-compatible"}</small>
        </div>
      </div>
      <div className="node-body">
        <div className="node-meta"><span className="mono">{m.model || "model id not set"}</span></div>
        <div className="node-meta"><span className="mono faint">{host}</span></div>
      </div>
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  );
});

export const ToolNodeView = memo(function ToolNodeView({ data }: NodeProps<FlowNode>) {
  const t = data.node.data as ToolData;
  const detail = t.transport === "stdio" ? [t.command, ...t.args].filter(Boolean).join(" ") : t.url;
  return (
    <div className={`node${data.hasError ? " has-error" : ""}${data.active ? " tool-active" : ""}`}>
      <PeerRing peer={data.peer} />
      <Handle type="target" position={Position.Left} id="in" />
      <div className="node-head">
        <div className="node-glyph tool"><Plug size={15} /></div>
        <div className="node-title">
          <b>{t.label || t.name}</b>
          <small>MCP · {t.transport === "stdio" ? "local process" : "remote"}</small>
        </div>
      </div>
      <div className="node-body">
        <div className="node-meta"><span className="mono">{detail || "not configured"}</span></div>
      </div>
      <div className="node-foot">
        <span className={`dot ${data.active ? "run" : data.errored ? "fail" : ""}`} />
        <span className="grow mono">{data.active ? "calling…" : data.errored ? "last call errored" : `mcp__${t.name.replace(/[^A-Za-z0-9_]/g, "_")}__*`}</span>
      </div>
    </div>
  );
});

export const nodeTypes = { agent: AgentNodeView, model: ModelNodeView, tool: ToolNodeView };
