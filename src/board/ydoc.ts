/**
 * The shared board as a Yjs document. Used by the relay (persistence, compile)
 * and by every window (editing), so both read the graph the same way.
 *
 *   meta   Y.Map  schema, id, name
 *   nodes  Y.Map  nodeId -> Y.Map { kind, position, data: Y.Map<field, json> }
 *   edges  Y.Map  edgeId -> { id, source, target, order }
 *   notes  Y.Map  noteId -> Y.Map { text, color, position, pinned, author, at }  (sticky notes)
 *
 * Everything is keyed by id (never a Y.Array), so a relay restarted from the
 * JSON file and a window still holding the old document merge without
 * duplicating anything. Node fields are separate map entries, so two people
 * editing different fields of one node both keep their change.
 */
import * as Y from "yjs";
import { GRAPH_SCHEMA, type Graph, type GraphEdge, type GraphNode, type Note } from "../contracts/graph";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export function boardMaps(doc: Y.Doc) {
  return {
    meta: doc.getMap<Json>("meta"),
    nodes: doc.getMap<Y.Map<unknown>>("nodes"),
    edges: doc.getMap<GraphEdge>("edges"),
    notes: doc.getMap<Y.Map<unknown>>("notes"),
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

function noteToY(note: Note): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(note)) if (k !== "id") m.set(k, structuredClone(v));
  return m;
}

function noteFromY(id: string, m: Y.Map<unknown>): Note {
  const j = m.toJSON() as Partial<Note>;
  return { id, text: j.text ?? "", color: j.color ?? "yellow", position: j.position ?? { x: 0, y: 0 }, pinned: j.pinned ?? false, author: j.author ?? "", at: j.at ?? 0 };
}

/** Read the graph out of the doc (unvalidated: the compiler validates). Sorted by id. */
export function graphFromDoc(doc: Y.Doc): Graph {
  const { meta, nodes, edges, notes } = boardMaps(doc);
  const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const graph: Graph = {
    schema: GRAPH_SCHEMA,
    id: String(meta.get("id") ?? ""),
    name: String(meta.get("name") ?? ""),
    nodes: [...nodes.entries()].map(([id, m]) => nodeFromY(id, m)).sort(byId),
    edges: [...edges.values()].map((e) => ({ ...e })).sort(byId),
  };
  // Only boards that have notes carry the field, so every other board reads exactly as before.
  if (notes.size) graph.notes = [...notes.entries()].map(([id, m]) => noteFromY(id, m)).sort(byId);
  return graph;
}

/** Replace the doc's content with `graph` in one transaction. */
export function loadGraphIntoDoc(doc: Y.Doc, graph: Graph): void {
  const { meta, nodes, edges, notes } = boardMaps(doc);
  doc.transact(() => {
    for (const id of [...notes.keys()]) if (!(graph.notes ?? []).some((n) => n.id === id)) notes.delete(id);
    for (const n of graph.notes ?? []) notes.set(n.id, noteToY(n));
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

// ---- sticky notes ----

export function addNote(doc: Y.Doc, note: Note): void {
  boardMaps(doc).notes.set(note.id, noteToY(note));
}

export function setNoteField<K extends keyof Omit<Note, "id">>(doc: Y.Doc, id: string, field: K, value: Note[K]): void {
  boardMaps(doc).notes.get(id)?.set(field, structuredClone(value));
}

export function removeNote(doc: Y.Doc, id: string): void {
  boardMaps(doc).notes.delete(id);
}
