import { useViewport, ViewportPortal } from "@xyflow/react";
import type { Peer } from "../state/board";

/** Other people's pointers, drawn in flow coordinates so they track pan and zoom. */
export function Cursors({ peers }: { peers: Peer[] }) {
  const { zoom } = useViewport();
  return (
    <ViewportPortal>
      {peers.filter((p) => p.cursor && p.tab === "graph").map((p) => (
        <div key={p.clientId} className="cursor" data-testid="peer-cursor" style={{ transform: `translate(${p.cursor!.x}px, ${p.cursor!.y}px) scale(${1 / zoom})` }}>
          <svg width="16" height="20" viewBox="0 0 16 20" style={{ position: "absolute", filter: "drop-shadow(0 1px 1px rgba(0,0,0,.25))" }}>
            <path d="M1 1 L1 16 L5 12 L8 19 L11 18 L8 11 L14 11 Z" fill={p.color} stroke="white" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          <span className="tag" style={{ background: p.color }}>{p.name}</span>
        </div>
      ))}
    </ViewportPortal>
  );
}
