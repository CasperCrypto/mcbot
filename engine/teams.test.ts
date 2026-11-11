/**
 * A hand-off edge, through real Hermes: the lead agent gives its teammate a task with
 * `kanban_create` in an ordinary run, the gateway's dispatcher hands it over, and the teammate
 * finishes it. Needs a Hermes: MCBOT_E2E=1 (McBot's own) or MCBOT_HERMES_BIN.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentSchedules, CompileResponse, TasksView } from "../src/contracts/api";
import { GRAPH_SCHEMA, type Graph } from "../src/contracts/graph";
import type { RunEvent } from "../src/contracts/run";
import { startStubLlm, type StubLlm } from "../test/stub-llm/server";
import { findHermes, stopGateway } from "./hermes";
import { startEngine, type Engine } from "./server";

const E2E = !!process.env.MCBOT_HERMES_BIN || process.env.MCBOT_E2E === "1";
const ORIGIN = "http://localhost:5173";

describe.skipIf(!E2E)("a team through Hermes' kanban", () => {
  let engine: Engine;
  let stub: StubLlm;
  let workspace: string;
  const api = async <T>(path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${engine.url}${path}`, { method: body === undefined ? "GET" : "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return (await res.json()) as T;
  };

  beforeAll(async () => {
    workspace = mkdtempSync(join(tmpdir(), "mcbot-team-"));
    stub = await startStubLlm();
    engine = await startEngine({ workspace, hermesHome: join(workspace, "hermes"), managedRoot: true, port: 0, host: "127.0.0.1", allowedOrigins: [ORIGIN] });
    const agent = (id: string, name: string, description: string) => ({ id, kind: "agent", position: { x: 0, y: 0 }, data: { name, displayName: "", description, soul: "", skills: [], capabilities: null } });
    const graph = {
      schema: GRAPH_SCHEMA, id: "launch", name: "Launch",
      nodes: [
        agent("n-lead", "lead", "Plans the launch."),
        agent("n-writer", "writer", "Writes the posts."),
        { id: "n-model", kind: "model", position: { x: 0, y: 0 }, data: { name: "local", label: "Local", endpoint: "local", baseUrl: stub.url, model: "stub-model", apiKeyEnv: "", pricing: null } },
      ],
      edges: [
        { id: "e1", source: "n-model", target: "n-lead", order: 0 },
        { id: "e2", source: "n-model", target: "n-writer", order: 0 },
        { id: "h1", source: "n-lead", target: "n-writer", order: 0 },
      ],
    } as unknown as Graph;
    await engine.relay.create("launch", "Launch", graph);
  });
  afterAll(async () => {
    const bin = await findHermes();
    if (bin) await stopGateway(bin, join(workspace, "hermes"));
    await engine?.close();
    await stub?.close();
  });

  it("compiles the hand-off into the lead's tool sets and SOUL.md", async () => {
    const res = await api<CompileResponse>("/api/compile", { boardId: "launch" });
    expect(res.ok).toBe(true);
    const root = join(workspace, "hermes", "profiles");
    expect(readFileSync(join(root, "lead", "config.yaml"), "utf8")).toContain("    - kanban\n");
    expect(readFileSync(join(root, "lead", "SOUL.md"), "utf8")).toContain("- `writer`: Writes the posts.\n");
    expect(readFileSync(join(root, "writer", "config.yaml"), "utf8")).not.toContain("platform_toolsets");
  });

  it("the lead hands the writer a task in a run; Hermes dispatches it and the writer finishes it", async () => {
    const body = 'call:kanban_complete {"summary":"Drafted the post"}';
    const prompt = `call:kanban_create ${JSON.stringify({ title: "Draft the launch post", assignee: "writer", body })}`;
    const { runId } = await api<{ runId: string }>("/api/runs", { boardId: "launch", agentNodeId: "n-lead", prompt });
    let events: RunEvent[] = [];
    for (const end = Date.now() + 240_000; Date.now() < end;) {
      events = await api<RunEvent[]>(`/api/runs/${runId}`);
      if (events.some((e) => e.type === "run.finished")) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(events.find((e) => e.type === "run.finished"), JSON.stringify(events.filter((e) => e.type !== "run.log").slice(-4))).toMatchObject({ status: "succeeded" });
    expect(events.find((e) => e.type === "run.tool.started")).toMatchObject({ tool: "kanban_create" });

    let task: TasksView["tasks"][number] | undefined;
    for (const end = Date.now() + 240_000; Date.now() < end;) {
      task = (await api<TasksView>("/api/tasks?boardId=launch")).tasks.find((t) => t.title === "Draft the launch post");
      if (task?.status === "done" || task?.status === "blocked") break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    expect(task).toMatchObject({ assignee: "writer", agentNodeId: "n-writer", createdBy: "lead", status: "done", result: "Drafted the post" });
  }, 600_000);

  it("schedules the writer; Hermes stores it, runs it on request, and pauses and removes it", async () => {
    const made = await api<AgentSchedules>("/api/schedules", { boardId: "launch", profile: "writer", when: "0 9 * * 1-5", prompt: "what is 2+2", name: "Morning sum" });
    expect(made.schedules).toEqual([expect.objectContaining({ name: "Morning sum", prompt: "what is 2+2", when: "0 9 * * 1-5", enabled: true, nextRunAt: expect.any(Number) })]);
    const id = made.schedules[0]!.id;
    await api("/api/schedules/act", { boardId: "launch", profile: "writer", id, action: "run" });
    let job = made.schedules[0]!;
    for (const end = Date.now() + 240_000; Date.now() < end && !job.lastRunAt;) {
      await new Promise((r) => setTimeout(r, 2000));
      job = (await api<AgentSchedules[]>("/api/schedules?boardId=launch")).find((a) => a.profile === "writer")!.schedules[0]!;
    }
    expect(job).toMatchObject({ lastRunAt: expect.any(Number), lastStatus: "ok" });
    const paused = await api<AgentSchedules>("/api/schedules/act", { boardId: "launch", profile: "writer", id, action: "pause" });
    expect(paused.schedules[0]).toMatchObject({ enabled: false });
    const gone = await api<AgentSchedules>("/api/schedules/act", { boardId: "launch", profile: "writer", id, action: "remove" });
    expect(gone.schedules).toEqual([]);
  }, 300_000);
});
