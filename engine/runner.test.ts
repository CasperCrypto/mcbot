import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunEvent } from "../src/contracts/run";
import type { HermesRuns } from "./hermesRuns";
import { Runner, STOP_GRACE_MS } from "./runner";
import { RunStore } from "./runStore";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "runner-"));
  mkdirSync(join(root, "profiles/triage/workspace"), { recursive: true });
  const store = new RunStore(join(root, "runs"));
  return { root, store };
}

const req = { boardId: "b", agentNodeId: "n", profile: "triage", prompt: "hi", toolNodes: [], models: [] };

async function finishedOf(store: RunStore, runId: string, within = STOP_GRACE_MS + 3000): Promise<RunEvent[]> {
  for (const end = Date.now() + within; Date.now() < end;) {
    const events = await store.events(runId);
    if (events.some((e) => e.type === "run.finished")) return events.filter((e) => e.type === "run.finished");
    await new Promise((r) => setTimeout(r, 100));
  }
  return [];
}

describe("a gateway that is restarting", () => {
  it("sends the run again when Hermes answers it is draining", async () => {
    const { root, store } = setup();
    let starts = 0;
    const runs = {
      up: async () => true,
      start: async () => {
        starts++;
        if (starts === 1) throw new Error("Gateway is draining existing work; retry shortly.");
        return "run_h3";
      },
      stop: async () => undefined,
      sessionOf: async () => null,
      events: async function* () { yield { event: "run.completed", output: "Done" }; },
    } as unknown as HermesRuns;
    const runner = new Runner({ store, root, managedRoot: false, api: { runs, env: {} }, findHermes: async () => ({ path: "hermes", shell: false, kind: "bundled" }) });
    const runId = await runner.start(req);
    const done = await finishedOf(store, runId, 8000);
    expect(starts).toBe(2);
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ status: "succeeded", text: "Done" });
  }, 15_000);

  it("sends a turn refused with runtime_draining again, but not one that already answered", async () => {
    const { root, store } = setup();
    let starts = 0;
    const runs = {
      up: async () => true,
      start: async () => `run_h${++starts}`,
      stop: async () => undefined,
      sessionOf: async () => null,
      events: async function* (_p: string, id: string) {
        if (id === "run_h1") yield { event: "run.failed", error: "runtime_draining" };
        else yield { event: "run.completed", output: "Answered" };
      },
    } as unknown as HermesRuns;
    const runner = new Runner({ store, root, managedRoot: false, api: { runs, env: {} }, findHermes: async () => ({ path: "hermes", shell: false, kind: "bundled" }) });
    const runId = await runner.start(req);
    const done = await finishedOf(store, runId, 8000);
    expect(starts).toBe(2);
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ status: "succeeded", text: "Answered" });
  }, 15_000);

  it("fails at once for any other refusal", async () => {
    const { root, store } = setup();
    let starts = 0;
    const runs = {
      up: async () => true,
      start: async () => { starts++; throw new Error("Unknown profile"); },
      stop: async () => undefined,
      sessionOf: async () => null,
      events: async function* () { /* none */ },
    } as unknown as HermesRuns;
    const runner = new Runner({ store, root, managedRoot: false, api: { runs, env: {} }, findHermes: async () => ({ path: "hermes", shell: false, kind: "bundled" }) });
    const runId = await runner.start(req);
    const done = await finishedOf(store, runId, 5000);
    expect(starts).toBe(1);
    expect(done[0]).toMatchObject({ status: "failed", error: "Unknown profile" });
  }, 15_000);
});

describe("what is true right now", () => {
  it("goes to Hermes with the run as its instructions, and not when there is none", async () => {
    const { root, store } = setup();
    const sent: (string | undefined)[] = [];
    const runs = {
      up: async () => true,
      start: async (_p: string, _prompt: string, instructions?: string) => { sent.push(instructions); return `run_i${sent.length}`; },
      stop: async () => undefined,
      sessionOf: async () => null,
      events: async function* () { yield { event: "run.completed", output: "ok" }; },
    } as unknown as HermesRuns;
    const runner = new Runner({ store, root, managedRoot: false, api: { runs, env: {} }, findHermes: async () => ({ path: "hermes", shell: false, kind: "bundled" }) });
    await finishedOf(store, await runner.start({ ...req, instructions: "## Right now (from McBot)\n- a task" }), 8000);
    await finishedOf(store, await runner.start(req), 8000);
    expect(sent).toEqual(["## Right now (from McBot)\n- a task", undefined]);
  }, 20_000);
});

describe("stopping a run", () => {
  it("stops a one-shot Hermes that ignores SIGINT", async () => {
    const { root, store } = setup();
    const script = join(root, "stubborn.cjs");
    writeFileSync(script, "process.on('SIGINT', () => {}); setInterval(() => {}, 1000);\n");
    const runner = new Runner({ store, root, managedRoot: false, findHermes: async () => ({ path: process.execPath, prefix: [script], shell: false, kind: "external" }) });
    const runId = await runner.start(req);
    await new Promise((r) => setTimeout(r, 500));
    expect(runner.cancel(runId)).toBe(true);
    const done = await finishedOf(store, runId);
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ status: "interrupted" });
  }, 15_000);

  it("ends a runs-API run that keeps going after Hermes was asked to stop, once", async () => {
    const { root, store } = setup();
    let stops = 0;
    const runs = {
      up: async () => true,
      start: async () => "run_h1",
      stop: async () => { stops++; },
      sessionOf: async () => null,
      // Hermes is mid-step: no event comes until McBot stops listening.
      events: async function* (_p: string, _id: string, signal: AbortSignal) {
        await new Promise<void>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
        yield {} as never;
      },
    } as unknown as HermesRuns;
    const runner = new Runner({ store, root, managedRoot: false, api: { runs, env: {} }, findHermes: async () => ({ path: "hermes", shell: false, kind: "bundled" }) });
    const runId = await runner.start(req);
    await new Promise((r) => setTimeout(r, 300));
    expect(runner.cancel(runId)).toBe(true);
    const done = await finishedOf(store, runId);
    expect(stops).toBe(1);
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ status: "interrupted", error: "Stopped" });
  }, 15_000);

  it("stops a run that is still starting before Hermes is asked", async () => {
    const { root, store } = setup();
    let started = 0;
    let upCalls = 0;
    const runs = {
      up: async () => { upCalls++; await new Promise((r) => setTimeout(r, 400)); return true; },
      start: async () => { started++; return "run_h2"; },
      stop: async () => undefined,
      sessionOf: async () => null,
      events: async function* () { /* none */ },
    } as unknown as HermesRuns;
    const runner = new Runner({ store, root, managedRoot: false, api: { runs, env: {} }, findHermes: async () => ({ path: "hermes", shell: false, kind: "bundled" }) });
    const runId = await runner.start(req);
    await new Promise((r) => setTimeout(r, 50));
    expect(runner.cancel(runId)).toBe(true);
    const done = await finishedOf(store, runId);
    expect(upCalls).toBeGreaterThan(0);
    expect(started).toBe(0);
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ status: "interrupted" });
  }, 15_000);
});
