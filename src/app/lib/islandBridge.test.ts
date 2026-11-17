import { describe, expect, it } from "vitest";
import type { RunSummary } from "../../contracts/run";
import { islandStateOf } from "./islandBridge";

const run = (o: Partial<RunSummary>): RunSummary => ({ runId: "r", profile: "writer", status: "running", startedAt: 1, approval: null, ...o }) as RunSummary;
const name = (r: RunSummary) => r.profile;

describe("islandStateOf", () => {
  it("is quiet with nothing to do", () => {
    expect(islandStateOf([], name, 0)).toEqual({ mode: "rest", text: "McBot", count: 0 });
    expect(islandStateOf([], name, 2).text).toBe("2 need you");
    expect(islandStateOf([], name, 1).text).toBe("1 needs you");
  });
  it("shows work, and a question before work", () => {
    expect(islandStateOf([run({})], name, 0)).toMatchObject({ mode: "run", text: "writer is working" });
    expect(islandStateOf([run({}), run({ runId: "b", profile: "x" })], name, 0).text).toBe("2 agents working");
    const ask = run({ runId: "q", approval: { promptId: "p", command: "rm -rf x", description: "d", choices: [] } });
    expect(islandStateOf([run({}), ask], name, 1)).toMatchObject({ mode: "ask", runId: "q", sub: "rm -rf x" });
  });
  it("ignores finished runs", () => {
    expect(islandStateOf([run({ status: "succeeded" })], name, 0).mode).toBe("rest");
  });
});
