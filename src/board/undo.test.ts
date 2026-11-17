import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import type { GraphNode } from "../contracts/graph";
import { redo, stopCapturing, undo, undoManager } from "./undo";
import { addNode, boardMaps, graphFromDoc, moveNode, removeNodes, setNodeField } from "./ydoc";

const agent = (id: string, name: string): GraphNode => ({ id, kind: "agent", position: { x: 0, y: 0 }, data: { name, displayName: name, soul: "", capabilities: [], skills: [] } } as unknown as GraphNode);
const names = (doc: Y.Doc) => graphFromDoc(doc).nodes.map((n) => n.data.name);

describe("board undo", () => {
  it("takes back this window's edits one step at a time, and redoes them", () => {
    const doc = new Y.Doc();
    undoManager(doc);
    addNode(doc, agent("a", "alpha"));
    stopCapturing(doc);
    addNode(doc, agent("b", "beta"));
    stopCapturing(doc);
    removeNodes(doc, ["a"]);
    expect(names(doc)).toEqual(["beta"]);
    expect(undo(doc)).toBe(true);
    expect(names(doc)).toEqual(["alpha", "beta"]);
    expect(undo(doc)).toBe(true);
    expect(names(doc)).toEqual(["alpha"]);
    expect(redo(doc)).toBe(true);
    expect(names(doc)).toEqual(["alpha", "beta"]);
  });

  it("groups a drag or typing into one step", () => {
    const doc = new Y.Doc();
    undoManager(doc);
    addNode(doc, agent("a", "alpha"));
    stopCapturing(doc);
    for (let x = 0; x <= 100; x += 10) moveNode(doc, "a", { x, y: 0 });
    for (const s of ["H", "He", "Hel", "Hello"]) setNodeField(doc, "a", "soul", s);
    expect(undo(doc)).toBe(true);
    const n = graphFromDoc(doc).nodes[0]!;
    expect(n.position).toEqual({ x: 0, y: 0 });
    expect((n.data as { soul: string }).soul).toBe("");
  });

  it("never undoes a teammate's edit", () => {
    const mine = new Y.Doc();
    const theirs = new Y.Doc();
    const remote = { name: "provider" };
    undoManager(mine);
    addNode(theirs, agent("t", "theirs"));
    Y.applyUpdate(mine, Y.encodeStateAsUpdate(theirs), remote);
    expect(names(mine)).toEqual(["theirs"]);
    expect(undo(mine)).toBe(false);
    expect(names(mine)).toEqual(["theirs"]);
    addNode(mine, agent("m", "mine"));
    expect(undo(mine)).toBe(true);
    expect(names(mine)).toEqual(["theirs"]);
  });

  it("leaves team chat alone", () => {
    const doc = new Y.Doc();
    undoManager(doc);
    boardMaps(doc).messages.set("m1", { id: "m1", author: "me", color: "#fff", agent: null, text: "hi", at: 1 } as never);
    expect(undo(doc)).toBe(false);
    expect(boardMaps(doc).messages.size).toBe(1);
  });
});
