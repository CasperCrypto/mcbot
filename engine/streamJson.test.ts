import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StreamMapper } from "./streamJson";

/** Real `hermes chat --format stream-json` captures (paths scrubbed to /HERMES_HOME). */
const capture = (name: string) => readFileSync(join(import.meta.dirname, "../test/fixtures/hermes-stream", `${name}.jsonl`), "utf8").split("\n");

function run(name: string, tools = [{ id: "n-tool", name: "files" }]) {
  const m = new StreamMapper(tools);
  return capture(name).flatMap((l) => m.feed(l));
}

describe("StreamMapper on real Hermes output", () => {
  it("maps a plain answer to text + session + finished with tokens", () => {
    const events = run("answer");
    expect(events.map((e) => e.type)).toEqual(["run.text", "run.session", "run.finished"]);
    expect(events[2]).toMatchObject({
      status: "succeeded",
      exitCode: 0,
      text: "4",
      sessionId: "local-981afbe5fc81df375cab076a59dd34ba5255a8d7c386dd1ebeb47f97e0f0447d",
      tokens: { input: 1245, output: 1, total: 1246, cacheRead: 0, cacheWrite: 0 },
      error: null,
    });
  });

  it("maps Hermes' memory tool call and result", () => {
    const events = run("memory-write");
    const started = events.find((e) => e.type === "run.tool.started");
    const done = events.find((e) => e.type === "run.tool.finished");
    expect(started).toMatchObject({ tool: "memory", toolNodeId: null, input: { action: "add", target: "memory" } });
    expect(done).toMatchObject({ tool: "memory", isError: false, durationMs: 16 });
    expect(events.at(-1)).toMatchObject({ type: "run.finished", status: "succeeded", text: "Saved to memory: The Acme escalation channel is #acme-urgent" });
  });

  it("attributes an MCP call to its tool node by Hermes' mcp__<server>__ prefix", () => {
    const events = run("mcp-tool-error");
    const started = events.find((e) => e.type === "run.tool.started");
    const done = events.find((e) => e.type === "run.tool.finished");
    expect(started).toMatchObject({ tool: "mcp__files__list_directory", toolNodeId: "n-tool" });
    expect(done).toMatchObject({ tool: "mcp__files__list_directory", toolNodeId: "n-tool", isError: true });
    expect(events.at(-1)).toMatchObject({ type: "run.finished", status: "succeeded" });
  });

  it("surfaces a Hermes-side failure as a failed run with its error", () => {
    expect(run("source-rejected").at(-1)).toMatchObject({
      type: "run.finished", status: "failed", exitCode: 1, sessionId: null, error: "Gateway does not support source 'mcbot'",
    });
  });
});

describe("StreamMapper edge cases", () => {
  it("unwraps the tool_call bridge to the deferred tool's name", () => {
    const m = new StreamMapper([{ id: "t", name: "my-api" }]);
    const [e] = m.feed(JSON.stringify({ type: "tool_use", name: "tool_call", tool_call_id: "c1", input: { name: "mcp__my_api__query", arguments: {} } }));
    expect(e).toMatchObject({ type: "run.tool.started", tool: "mcp__my_api__query", toolNodeId: "t" });
    const [r] = m.feed(JSON.stringify({ type: "tool_result", name: "tool_call", tool_call_id: "c1", output: "ok", duration_ms: 3, is_error: false }));
    expect(r).toMatchObject({ type: "run.tool.finished", tool: "mcp__my_api__query", toolNodeId: "t" });
  });

  it("keeps non-JSON and unknown records as logs", () => {
    const m = new StreamMapper([]);
    expect(m.feed("Session: abc")).toEqual([{ type: "run.log", stream: "stdout", line: "Session: abc" }]);
    expect(m.feed('{"type":"future_thing"}')).toEqual([{ type: "run.log", stream: "stdout", line: '{"type":"future_thing"}' }]);
  });

  it("finishes a run that died without a result record", () => {
    const m = new StreamMapper([]);
    m.feed(JSON.stringify({ type: "text", text: "partial" }));
    expect(m.finish(1, null, 50, ["", "Traceback ...", "ValueError: boom"])).toMatchObject({
      type: "run.finished", status: "failed", exitCode: 1, text: "partial",
      error: "hermes exited (code 1) without a result record: Traceback ... | ValueError: boom",
    });
    expect(m.finish(1, null, 50, [])).toBeNull();
  });
});
