/**
 * The shared board as a Yjs document. Used by the relay (persistence, compile)
 * and by every window (editing), so both read the graph the same way.
 *
 *   meta   Y.Map  schema, id, name
 *   nodes  Y.Map  nodeId -> Y.Map { kind, position, data: Y.Map<field, json> }
 *   edges  Y.Map  edgeId -> { id, source, target, order }
 *
 * Everything is keyed by id (never a Y.Array), so a relay restarted from the
 * JSON file and a window still holding the old document merge without
 * duplicating anything. Node fields are separate map entries, so two people
 * editing different fields of one node both keep their change.
 */
import * as Y from "yjs";
import { GRAPH_SCHEMA, type Graph, type GraphEdge, type GraphNode } from "../contracts/graph";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export function boardMaps(doc: Y.Doc) {
  return {
    meta: doc.getMap<Json>("meta"),
    nodes: doc.getMap<Y.Map<unknown>>("nodes"),
    edges: doc.getMap<GraphEdge>("edges"),
  };
}

function nodeToY(node: GraphNode): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set("kind", node.kind);
  m.set("position", { x: node.position.x, y: node.position.y });
  const data = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(node.data)) data.set(k, structuredClone(v));
  m.set("data", data);
  return m;
}

function nodeFromY(id: string, m: Y.Map<unknown>): GraphNode {
  const data = m.get("data");
  return {
    id,
    kind: m.get("kind"),
    position: m.get("position") ?? { x: 0, y: 0 },
    data: data instanceof Y.Map ? data.toJSON() : {},
  } as GraphNode;
}

/** Read the graph out of the doc (unvalidated: the compiler validates). Sorted by id. */
export function graphFromDoc(doc: Y.Doc): Graph {
  const { meta, nodes, edges } = boardMaps(doc);
  const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    schema: GRAPH_SCHEMA,
    id: String(meta.get("id") ?? ""),
    name: String(meta.get("name") ?? ""),
    nodes: [...nodes.entries()].map(([id, m]) => nodeFromY(id, m)).sort(byId),
    edges: [...edges.values()].map((e) => ({ ...e })).sort(byId),
  };
}

/** Replace the doc's content with `graph` in one transaction. */
export function loadGraphIntoDoc(doc: Y.Doc, graph: Graph): void {
  const { meta, nodes, edges } = boardMaps(doc);
  doc.transact(() => {
    meta.set("schema", GRAPH_SCHEMA);
    meta.set("id", graph.id);
    meta.set("name", graph.name);
    for (const id of [...nodes.keys()]) if (!graph.nodes.some((n) => n.id === id)) nodes.delete(id);
    for (const id of [...edges.keys()]) if (!graph.edges.some((e) => e.id === id)) edges.delete(id);
    for (const n of graph.nodes) nodes.set(n.id, nodeToY(n));
    for (const e of graph.edges) edges.set(e.id, { ...e });
  });
}

// ---- edits used by the UI (each one transaction, origin = local user) ----

export function addNode(doc: Y.Doc, node: GraphNode): void {
  boardMaps(doc).nodes.set(node.id, nodeToY(node));
}

export function moveNode(doc: Y.Doc, id: string, position: { x: number; y: number }): void {
  boardMaps(doc).nodes.get(id)?.set("position", { x: Math.round(position.x), y: Math.round(position.y) });
}

export function setNodeField(doc: Y.Doc, id: string, field: string, value: unknown): void {
  const data = boardMaps(doc).nodes.get(id)?.get("data");
  if (data instanceof Y.Map) data.set(field, structuredClone(value));
}

export function removeNodes(doc: Y.Doc, ids: readonly string[]): void {
  const { nodes, edges } = boardMaps(doc);
  doc.transact(() => {
    for (const id of ids) nodes.delete(id);
    for (const [eid, e] of [...edges.entries()]) if (ids.includes(e.source) || ids.includes(e.target)) edges.delete(eid);
  });
}

export function addEdge(doc: Y.Doc, edge: GraphEdge): void {
  boardMaps(doc).edges.set(edge.id, { ...edge });
}

export function updateEdge(doc: Y.Doc, id: string, patch: Partial<Omit<GraphEdge, "id">>): void {
  const { edges } = boardMaps(doc);
  const e = edges.get(id);
  if (e) edges.set(id, { ...e, ...patch });
}

export function removeEdges(doc: Y.Doc, ids: readonly string[]): void {
  const { edges } = boardMaps(doc);
  doc.transact(() => ids.forEach((id) => edges.delete(id)));
}

export function renameBoard(doc: Y.Doc, name: string): void {
  boardMaps(doc).meta.set("name", name);
}
