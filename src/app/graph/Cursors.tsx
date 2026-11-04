import { useViewport, ViewportPortal } from "@xyflow/react";
import type { Peer } from "../state/board";

/** Other people's pointers, in flow coordinates so they track pan and zoom. */
export function Cursors({ peers }: { peers: Peer[] }) {
  const { zoom } = useViewport();
  return (
    <ViewportPortal>
      {peers.filter((p) => p.cursor && p.tab === "graph").map((p) => (
        <div key={p.clientId} className="cursor" data-testid="peer-cursor" style={{ transform: `translate(${p.cursor!.x}px, ${p.cursor!.y}px) scale(${1 / zoom})` }}>
          <svg width="18" height="22" viewBox="0 0 18 22" style={{ position: "absolute", filter: "drop-shadow(0 2px 3px rgba(0,0,0,.45))" }}>
            <path d="M2 1.5 L2 17.5 L6.4 13.4 L9.3 20.2 L12.4 19 L9.5 12.3 L15.6 12.3 Z" fill={p.color} stroke="white" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
          <span className="tag" style={{ background: p.color }}>{p.name}</span>
        </div>
      ))}
    </ViewportPortal>
  );
}
