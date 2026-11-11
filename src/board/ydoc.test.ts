import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { GraphSchema } from "../contracts/graph";
import { compile } from "../compile";
import { addNote, graphFromDoc, loadGraphIntoDoc, moveNode, removeNodes, setNodeField, setNoteField } from "./ydoc";

const fixture = GraphSchema.parse(JSON.parse(readFileSync(join(import.meta.dirname, "../../test/fixtures/full.graph.json"), "utf8")));

function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
}

describe("board ydoc", () => {
  it("round-trips a graph losslessly and compiles identically", () => {
    const doc = new Y.Doc();
    loadGraphIntoDoc(doc, fixture);
    const back = GraphSchema.parse(graphFromDoc(doc));
    expect(compile(back)).toEqual(compile(fixture));
  });

  it("merges concurrent edits to different fields of the same node", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    loadGraphIntoDoc(a, fixture);
    sync(a, b);
    setNodeField(a, "a1", "displayName", "Research lead");
    moveNode(b, "a1", { x: 40.4, y: 80.6 });
    setNodeField(b, "a1", "description", "Finds sources.");
    sync(a, b);
    const node = graphFromDoc(a).nodes.find((n) => n.id === "a1")!;
    expect(node.position).toEqual({ x: 40, y: 81 });
    expect(node.data).toMatchObject({ displayName: "Research lead", description: "Finds sources." });
    expect(graphFromDoc(a)).toEqual(graphFromDoc(b));
  });

  it("does not duplicate nodes when a relay reloads from JSON and an old client reconnects", () => {
    const client = new Y.Doc();
    loadGraphIntoDoc(client, fixture);
    const restartedRelay = new Y.Doc();
    loadGraphIntoDoc(restartedRelay, GraphSchema.parse(graphFromDoc(client)));
    sync(client, restartedRelay);
    expect(graphFromDoc(restartedRelay).nodes).toHaveLength(fixture.nodes.length);
    expect(graphFromDoc(restartedRelay)).toEqual(graphFromDoc(client));
  });

  it("removes a node's edges with it", () => {
    const doc = new Y.Doc();
    loadGraphIntoDoc(doc, fixture);
    removeNodes(doc, ["m-local"]);
    expect(graphFromDoc(doc).edges.map((e) => e.id)).toEqual(["e1", "e10", "e3", "e4", "e6", "e7", "e8", "e9"]);
  });

  it("keeps sticky notes, merges edits to them, and leaves a board without notes as it was", () => {
    const a = new Y.Doc();
    loadGraphIntoDoc(a, fixture);
    expect("notes" in graphFromDoc(a)).toBe(false);
    addNote(a, { id: "note-1", text: "Ship Friday", color: "yellow", position: { x: 10, y: 20 }, pinned: true, author: "Ada", at: 1 });
    const b = new Y.Doc();
    sync(a, b);
    setNoteField(a, "note-1", "text", "Ship Friday, after review");
    setNoteField(b, "note-1", "color", "green");
    sync(a, b);
    expect(graphFromDoc(b).notes).toEqual([{ id: "note-1", text: "Ship Friday, after review", color: "green", position: { x: 10, y: 20 }, pinned: true, author: "Ada", at: 1 }]);
    const c = new Y.Doc();
    loadGraphIntoDoc(c, GraphSchema.parse(JSON.parse(JSON.stringify(graphFromDoc(b)))));
    expect(graphFromDoc(c).notes?.[0]?.text).toBe("Ship Friday, after review");
    expect(compile(graphFromDoc(b)).files).toEqual(compile(fixture).files);
  });
});
