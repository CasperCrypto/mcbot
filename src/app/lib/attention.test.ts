import { describe, expect, it } from "vitest";
import type { TaskView } from "../../contracts/api";
import type { RunSummary } from "../../contracts/run";
import { attentionCount } from "./attention";

const task = (status: TaskView["status"], assignee: string | null = "writer") => ({ status, assignee }) as TaskView;
const run = (status: RunSummary["status"], startedAt: number) => ({ status, startedAt }) as RunSummary;

describe("attentionCount", () => {
  it("counts what Home's Needs you lists: reviews, blocks, unassigned work, recent failures, a stale compile", () => {
    const now = 10 * 86_400_000;
    const tasks = [task("review"), task("blocked"), task("todo", null), task("done", null), task("running")];
    const runs = [run("failed", now - 1000), run("failed", now - 2 * 86_400_000), run("succeeded", now)];
    expect(attentionCount(tasks, runs, 3, now)).toBe(5);
    expect(attentionCount([], [], null, now)).toBe(0);
  });
});
