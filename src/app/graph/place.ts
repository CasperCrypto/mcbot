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

/**
 * Where a new sticky note goes: at the anchor, then stepped right and down until it covers no
 * block or other note (notes sit behind blocks, so a covered note can't be grabbed).
 */
export function noteSpot(graph: Graph, anchor: { x: number; y: number }): { x: number; y: number } {
  const NW = 240, NH = 170;
  const boxes = [
    ...graph.nodes.map((n) => ({ x: n.position.x, y: n.position.y, w: W, h: H })),
    ...(graph.notes ?? []).map((n) => ({ x: n.position.x, y: n.position.y, w: NW, h: NH })),
  ];
  const hits = (x: number, y: number) => boxes.some((b) => x < b.x + b.w + 16 && x + NW + 16 > b.x && y < b.y + b.h + 16 && y + NH + 16 > b.y);
  const start = { x: Math.round(anchor.x - NW / 2), y: Math.round(anchor.y - NH / 2) };
  for (let ring = 0; ring < 12; ring++) {
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const p = { x: start.x + dx! * ring * (NW / 2 + 20), y: start.y + dy! * ring * (NH / 2 + 20) };
      if (!hits(p.x, p.y)) return p;
    }
  }
  return start;
}
