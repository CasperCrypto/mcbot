import { describe, expect, it } from "vitest";
import type { Graph } from "../../contracts/graph";
import { agentsWithoutModel, attachModel, chainOf } from "./models";

const agent = (id: string) => ({ id, kind: "agent" as const, position: { x: 0, y: 0 }, data: { name: id, displayName: "", description: "", soul: "", skills: [], capabilities: null } });
const model = (id: string) => ({ id, kind: "model" as const, position: { x: 0, y: 0 }, data: { name: id, label: "", endpoint: "local" as const, baseUrl: "http://127.0.0.1:11434/v1", model: "m", apiKeyEnv: "", pricing: null } });
const g: Graph = {
  schema: "mcbot.graph/v1", id: "t", name: "t",
  nodes: [agent("a"), agent("b"), model("m1"), model("m2")],
  edges: [{ id: "e1", source: "m1", target: "a", order: 0 }],
};

describe("models on a board", () => {
  it("finds agents with no model", () => {
    expect(agentsWithoutModel(g).map((a) => a.id)).toEqual(["b"]);
  });

  it("adds a backup at the end of the chain, or a main model in front", () => {
    let n = 0;
    const id = () => `x${++n}`;
    expect(attachModel(g, "m2", ["a", "b"], false, id)).toEqual({ add: [{ id: "x1", source: "m2", target: "a", order: 1 }, { id: "x2", source: "m2", target: "b", order: 0 }], reorder: [] });
    expect(attachModel(g, "m2", ["a"], true, id)).toEqual({ add: [{ id: "x3", source: "m2", target: "a", order: 0 }], reorder: [{ id: "e1", order: 1 }] });
    expect(attachModel(g, "m1", ["a"], true, id).add).toEqual([]);
    expect(chainOf(g, "a").map((e) => e.source)).toEqual(["m1"]);
  });
});

describe("local model health", () => {
  it("matches the model the server lists", async () => {
    const { localHealth } = await import("./models");
    expect(localHealth("qwen3:8b", ["qwen3:8b"])).toBe("ok");
    expect(localHealth("llama3.2", ["llama3.2:latest"])).toBe("ok");
    expect(localHealth("qwen3:8b", ["gemma3:4b"])).toBe("missing");
    expect(localHealth("qwen3:8b", null)).toBe("down");
  });
});

describe("making a model the main one", () => {
  it("moves it to the front of every chain it is in", async () => {
    const { promoteModel } = await import("./models");
    const g2: Graph = { ...g, edges: [{ id: "e1", source: "m1", target: "a", order: 0 }, { id: "e2", source: "m2", target: "a", order: 1 }] };
    expect(promoteModel(g2, "m2")).toEqual([{ id: "e2", order: 0 }, { id: "e1", order: 1 }]);
    expect(promoteModel(g2, "m1")).toEqual([]);
  });
});
