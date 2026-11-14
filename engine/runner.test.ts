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
