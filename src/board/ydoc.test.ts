import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { GraphSchema } from "../contracts/graph";
import { compile } from "../compile";
import { graphFromDoc, loadGraphIntoDoc, moveNode, removeNodes, setNodeField } from "./ydoc";

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
    expect(graphFromDoc(doc).edges.map((e) => e.id)).toEqual(["e1", "e3", "e4"]);
  });
});
