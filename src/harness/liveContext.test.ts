import { describe, expect, it } from "vitest";
import type { TaskView, TaskWork } from "../contracts/api";
import { LIVE_HEAD, liveContext, span } from "./liveContext";

const NOW = Date.UTC(2026, 10, 25, 12, 0, 0);
const MIN = 60_000;
const task = (over: Partial<TaskView>): TaskView => ({
  id: "t_ab12", title: "make new tab sheets", body: "", assignee: "coder", agentNodeId: "n-coder", status: "todo", priority: 0,
  createdBy: "Kacper", createdAt: NOW - 40 * MIN, startedAt: null, completedAt: null, result: null, error: null,
  parents: [], children: [], comments: 0, ...over,
});
const names: Record<string, string> = { coder: "Coder", writer: "Writer" };
const nameOf = (who: string) => names[who] ?? who;

describe("what an agent knows right now", () => {
  it("tells the agent in chat about the task its own run is working on, and how far it got", () => {
    const work = new Map<string, TaskWork>([["t_ab12", { steps: 14, recent: [{ tool: "write_file", detail: "src/app/Sheets.tsx", at: NOW - MIN }], said: null, lastAt: NOW - MIN }]]);
    const text = liveContext({
      profile: "coder", now: NOW, nameOf, work,
      tasks: [task({ status: "running", startedAt: NOW - 32 * MIN, body: "mke new tab in this tab with docs and sheets so i can edit and export etc" })],
    })!;
    expect(text).toBe([
      LIVE_HEAD,
      "Your tasks on the board. Each runs in a session of its own; this chat knows only what is listed here.",
      `- "make new tab sheets" (t_ab12): you are working on it in its own run, for 32 min; 14 steps so far, the last 1 min ago (write_file src/app/Sheets.tsx). From Kacper: "mke new tab in this tab with docs and sheets so i can edit and export etc"`,
      "When the person asks about this work, answer from this list: what the run is doing, how long it has taken, and that its result will appear on the task in Tasks.",
    ].join("\n"));
  });

  it("lists what waits, what is blocked, what it finished today and what it gave to others", () => {
    const text = liveContext({
      profile: "coder", now: NOW, nameOf,
      tasks: [
        task({ id: "t_1", title: "Fix the login", status: "ready" }),
        task({ id: "t_2", title: "Ship it", status: "blocked", error: "needs a key" }),
        task({ id: "t_3", title: "Old report", status: "done", completedAt: NOW - 2 * 60 * MIN, result: "Sent to Sam" }),
        task({ id: "t_4", title: "Last week", status: "done", completedAt: NOW - 8 * 24 * 60 * MIN }),
        task({ id: "t_5", title: "Write the docs", assignee: "writer", createdBy: "coder", status: "running", startedAt: NOW - 10 * MIN }),
        task({ id: "t_6", title: "Someone else's", assignee: "writer", createdBy: "Kacper", status: "running" }),
      ],
    })!;
    expect(text).toContain(`- "Fix the login" (t_1): waiting for you to start it. From Kacper`);
    expect(text).toContain(`- "Ship it" (t_2): blocked: needs a key. From Kacper`);
    expect(text).toContain(`Done in the last day:\n- "Old report" (t_3): done 2 h ago. Result: Sent to Sam. From Kacper`);
    expect(text).not.toContain("Last week");
    expect(text).toContain(`Work you gave to others:\n- "Write the docs" (t_5) → Writer: Writer is working on it in its own run, for 10 min.`);
    expect(text).not.toContain("Someone else's");
  });

  it("says nothing when the agent has no work on the board", () => {
    expect(liveContext({ profile: "coder", now: NOW, nameOf, tasks: [task({ assignee: "writer" })] })).toBeNull();
    expect(liveContext({ profile: "coder", now: NOW, nameOf, tasks: [] })).toBeNull();
  });

  it("says how long in words", () => {
    expect(span(20_000)).toBe("under a minute");
    expect(span(12 * MIN)).toBe("12 min");
    expect(span(125 * MIN)).toBe("2 h 5 min");
    expect(span(120 * MIN)).toBe("2 h");
    expect(span(3 * 24 * 60 * MIN)).toBe("3 days");
  });
});
