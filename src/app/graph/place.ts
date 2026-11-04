import type { Graph, GraphNode } from "../../contracts/graph";

const W = 240;
const H = 150;

/**
 * Where a new node goes: agents at the anchor, models to the left of the
 * agent they will serve, tools and makers to its right — then step down until the card
 * overlaps nothing.
 */
export function freeSpot(graph: Graph, kind: GraphNode["kind"], anchor: { x: number; y: number } | null, selectedId: string | null): { x: number; y: number } {
  const agents = graph.nodes.filter((n) => n.kind === "agent");
  const agent = kind === "agent" ? undefined : agents.find((n) => n.id === selectedId) ?? agents.at(-1);
  const base = agent ? { x: agent.position.x, y: agent.position.y } : anchor ? { x: anchor.x - W / 2, y: anchor.y - 60 } : { x: 0, y: 0 };
  const x = Math.round(base.x + (kind === "model" ? -320 : kind === "tool" || kind === "media" || kind === "channel" ? 320 : 0));
  let y = Math.round(base.y);
  const taken = (yy: number) => graph.nodes.some((n) => Math.abs(n.position.x - x) < W + 20 && Math.abs(n.position.y - yy) < H);
  for (let i = 0; i < 50 && taken(y); i++) y += H + 10;
  return { x, y };
}
