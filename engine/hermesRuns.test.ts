import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { summarizeRun, type RunEvent } from "../src/contracts/run";
import { apiEnv, gatewayApi, RunsApiMapper } from "./hermesRuns";

// Captured from McBot's own Hermes (docs/HERMES.md "Runs over Hermes' API server"), trimmed.
const CAPTURED = [
  { event: "tool.started", run_id: "run_x", timestamp: 1794507439.32, tool: "terminal", preview: "rm -rf /tmp/mcbot-approval-test", tool_call_id: "call_1", seq: 0 },
  { event: "approval.request", run_id: "run_x", timestamp: 1794507439.4, kind: "approval", prompt_id: "998a", execution_generation: 1, command: "rm -rf /tmp/mcbot-approval-test", description: "delete in root path", choices: ["once", "deny", "session", "always"], seq: 1 },
  { event: "approval.settled", run_id: "run_x", timestamp: 1794507439.45, prompt_id: "998a", execution_generation: 1, seq: 2 },
  { event: "tool.completed", run_id: "run_x", timestamp: 1794507439.52, tool: "terminal", duration: 0.25, error: false, tool_call_id: "call_1", preview: "", seq: 3 },
  { event: "message.delta", run_id: "run_x", timestamp: 1794507439.54, delta: "Done.", seq: 4 },
  { event: "run.completed", run_id: "run_x", timestamp: 1794507439.63, output: "Done.", usage: { input_tokens: 2873, output_tokens: 50, total_tokens: 2923 }, seq: 5 },
];

describe("runs through Hermes' runs API", () => {
  it("maps Hermes' events to McBot's, and the run waits on its approval until it is settled", () => {
    const m = new RunsApiMapper([]);
    const out = CAPTURED.flatMap((e) => m.map(e, Date.now()));
    expect(out.map((e) => e.type)).toEqual(["run.tool.started", "run.approval", "run.approval.settled", "run.tool.finished", "run.text", "run.finished"]);
    expect(out[1]).toEqual({ type: "run.approval", promptId: "998a", generation: 1, command: "rm -rf /tmp/mcbot-approval-test", description: "delete in root path", choices: ["once", "deny", "session", "always"] });
    expect(out[3]).toMatchObject({ tool: "terminal", durationMs: 250, isError: false });
    expect(out[5]).toMatchObject({ status: "succeeded", text: "Done.", tokens: { input: 2873, output: 50, total: 2923 } });

    const start = { v: 1, runId: "r", seq: 0, ts: 1, type: "run.started", boardId: "b", agentNodeId: "a", profile: "triage", prompt: "p", argv: [], hermesHome: "/h", cwd: "/c" } as RunEvent;
    const asEvents = (n: number) => [start, ...out.slice(0, n).map((e, i) => ({ v: 1, runId: "r", seq: i + 1, ts: 2 + i, ...e }) as RunEvent)];
    expect(summarizeRun(asEvents(2))!.approval).toMatchObject({ promptId: "998a", command: "rm -rf /tmp/mcbot-approval-test" });
    expect(summarizeRun(asEvents(3))!.approval).toBeNull();
  });

  it("makes one owner-only key per workspace and the .env lines that turn the API server on", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "mcbot-gw-")), "gateway.json");
    const a = await gatewayApi(file, 4555);
    expect(a.key).toMatch(/^[0-9a-f]{48}$/);
    expect(await gatewayApi(file)).toEqual(a);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(apiEnv(a)).toEqual({ API_SERVER_KEY: a.key, API_SERVER_PORT: "4555", API_SERVER_HOST: "127.0.0.1" });
  });
});
