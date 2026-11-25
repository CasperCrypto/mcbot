import { describe, expect, it } from "vitest";
import { GRAPH_SCHEMA, type Graph, type GraphNode } from "../../contracts/graph";
import { duplicateNode, freeDisplayName } from "./defaults";

const agent = (id: string, name: string): GraphNode => ({ id, kind: "agent", position: { x: 10, y: 20 }, data: { name, displayName: "Writer", description: "", soul: "Be brief.", skills: [], capabilities: null } } as unknown as GraphNode);
const g = (nodes: GraphNode[]): Graph => ({ schema: GRAPH_SCHEMA, id: "b", name: "b", nodes, edges: [] });

describe("duplicating a block", () => {
  it("gives the copy a new id, a free name, a title no other agent shows and a place beside the original", () => {
    const a = agent("agent-1", "writer");
    const c = duplicateNode(g([a]), a);
    expect(c.id).not.toBe(a.id);
    expect(c.position).toEqual({ x: 54, y: 64 });
    expect(c.data).toMatchObject({ name: "writer-copy", displayName: "Writer 2", soul: "Be brief." });
    expect(a.data.name).toBe("writer"); // the original is untouched
  });

  it("never reuses a name, also when copying a copy", () => {
    const a = agent("a1", "writer");
    const c1 = agent("a2", "writer-copy");
    expect(duplicateNode(g([a, c1]), a).data.name).toBe("writer-copy-2");
    expect(duplicateNode(g([a, c1]), c1).data.name).toBe("writer-copy-2");
  });
});

describe("agent names people see", () => {
  it("are never shown twice: a second Writer is Writer 2, a third Writer 3", () => {
    const board = g([agent("a1", "writer")]);
    expect(freeDisplayName(board, "Researcher")).toBe("Researcher");
    expect(freeDisplayName(board, "Writer")).toBe("Writer 2");
    expect(freeDisplayName(board, "writer ")).toBe("writer 2");
    expect(freeDisplayName(board, "Writer", ["Writer 2"])).toBe("Writer 3");
  });
});
