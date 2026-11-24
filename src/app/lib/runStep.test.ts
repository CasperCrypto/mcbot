import { describe, expect, it } from "vitest";
import type { RunEvent } from "../../contracts/run";
import { stepOf } from "./runStep";

const at = { v: 1 as const, runId: "r", ts: 0 };
const started: RunEvent = { ...at, seq: 0, type: "run.started", boardId: "b", agentNodeId: "a", profile: "p", prompt: "hi", argv: [], hermesHome: "/h", cwd: "/c" };

describe("stepOf", () => {
  it("names the tool an agent is using, and what it does between tools", () => {
    expect(stepOf(undefined)).toBe("Starting");
    expect(stepOf([started])).toBe("Thinking");
    const tool: RunEvent = { ...at, seq: 1, type: "run.tool.started", tool: "mcp__docs__search", toolNodeId: null };
    expect(stepOf([started, tool])).toBe("Docs: search");
    const done: RunEvent = { ...at, seq: 2, type: "run.tool.finished", tool: "mcp__docs__search", output: "", durationMs: 3, isError: false, toolNodeId: null };
    expect(stepOf([started, tool, done])).toBe("Thinking");
    expect(stepOf([started, tool, done, { ...at, seq: 3, type: "run.text", text: "Hi" }])).toBe("Writing");
    expect(stepOf([started, { ...at, seq: 1, type: "run.approval", promptId: "q", generation: 0, command: "rm x", description: "", choices: ["once"] }])).toBe("Waiting for you");
  });
});
