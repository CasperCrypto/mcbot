import { describe, expect, it } from "vitest";
import type { RunEvent } from "../../contracts/run";
import { isPlanStep, planOf } from "./plan";

const at = { v: 1 as const, runId: "r", ts: 0 };
const started = (seq: number, tool: string, input: unknown): RunEvent => ({ ...at, seq, type: "run.tool.started", tool, input, toolNodeId: null });
const finished = (seq: number, tool: string, output: string): RunEvent => ({ ...at, seq, type: "run.tool.finished", tool, output, durationMs: 1, isError: false, toolNodeId: null });

describe("planOf", () => {
  it("shows a fresh plan as soon as it is written, then the list Hermes returns", () => {
    const write = started(1, "todo_list", { todos: [{ id: "1", content: "Draft three posts", status: "in_progress" }, { id: "2", content: "Make an image for each", status: "pending" }] });
    expect(planOf([write])).toEqual([{ id: "1", content: "Draft three posts", status: "in_progress" }, { id: "2", content: "Make an image for each", status: "pending" }]);
    const done = finished(2, "todo_list", JSON.stringify({ todos: [{ id: "1", content: "Draft three posts", status: "completed" }, { id: "2", content: "Make an image for each", status: "in_progress" }], revision: 2 }));
    expect(planOf([write, done])?.map((i) => i.status)).toEqual(["completed", "in_progress"]);
  });

  it("reads a plan through Hermes' tool_call bridge, and ignores other tools", () => {
    const bridged = started(1, "tool_call", { name: "todo_list", arguments: { todos: [{ id: "a", content: "Research", status: "pending", parent: "" }] } });
    expect(planOf([bridged])).toEqual([{ id: "a", content: "Research", status: "pending" }]);
    expect(isPlanStep(bridged as Extract<RunEvent, { type: "run.tool.started" }>)).toBe(true);
    expect(planOf([started(1, "web_search", { q: "x" }), finished(2, "web_search", "{\"results\": []}")])).toBeNull();
    expect(planOf(undefined)).toBeNull();
  });
});
