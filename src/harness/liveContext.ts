/**
 * What is true right now about an agent's work, sent with each chat message as the runs API's
 * `instructions`: Hermes adds it to the system prompt for that one call and never stores it
 * (gateway/platforms/api_server_runs.py:499,873; agent/system_prompt.py:806). An agent's tasks run in
 * sessions of their own (Hermes' kanban), so without this the agent in chat can't know them and
 * answers "I don't see a task". Pure: tasks in, text out (engine/server.ts reads them).
 */
import type { TaskView, TaskWork } from "../contracts/api";

export const LIVE_HEAD = "## Right now (from McBot)";
const DAY = 86_400_000;
/** At most this many of each list, so a message stays short. */
const MAX = { open: 6, done: 3, given: 6 } as const;

export interface LiveContextInput {
  /** The agent's profile name (a task's `assignee`). */
  profile: string;
  tasks: readonly TaskView[];
  /** A running task's work so far, by task id (engine/hermesData.ts readTaskWork). */
  work?: ReadonlyMap<string, TaskWork>;
  /** A profile or person as people say it ("writer" → "Writer"). */
  nameOf: (who: string) => string;
  now: number;
}

/** "under a minute", "12 min", "2 h 5 min", "3 days". */
export function span(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return "under a minute";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  return `${Math.floor(h / 24)} days`;
}

const clip = (text: string, n: number) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

function state(t: TaskView, i: LiveContextInput, self: boolean): string {
  const who = self ? "you are" : `${i.nameOf(t.assignee ?? "")} is`;
  switch (t.status) {
    case "running": {
      const w = i.work?.get(t.id);
      const since = t.startedAt ? `, for ${span(i.now - t.startedAt)}` : "";
      const last = w?.recent.at(-1);
      const steps = w && w.steps ? `; ${w.steps} step${w.steps === 1 ? "" : "s"} so far, the last ${w.lastAt ? `${span(i.now - w.lastAt)} ago` : "earlier"}${last ? ` (${last.tool}${last.detail ? ` ${last.detail}` : ""})` : ""}` : "";
      return `${who} working on it in its own run${since}${steps}`;
    }
    case "blocked": return `blocked${t.error ? `: ${clip(t.error, 160)}` : ""}`;
    case "review": return "finished, waiting for a person to review it";
    case "done": return `done ${t.completedAt ? `${span(i.now - t.completedAt)} ago` : ""}${t.result ? `. Result: ${clip(t.result, 200)}` : ""}`.trim();
    case "scheduled": return "scheduled for later";
    default: return self ? "waiting for you to start it" : `waiting for ${i.nameOf(t.assignee ?? "")} to start it`;
  }
}

export function liveContext(i: LiveContextInput): string | null {
  const recent = (t: TaskView) => t.status !== "done" || (t.completedAt ?? 0) > i.now - DAY;
  const mine = i.tasks.filter((t) => t.assignee === i.profile && t.status !== "archived" && recent(t));
  const open = mine.filter((t) => t.status !== "done").slice(0, MAX.open);
  const done = mine.filter((t) => t.status === "done").slice(0, MAX.done);
  const given = i.tasks.filter((t) => t.createdBy === i.profile && t.assignee && t.assignee !== i.profile && t.status !== "archived" && recent(t)).slice(0, MAX.given);
  if (!open.length && !done.length && !given.length) return null;
  const line = (t: TaskView, self: boolean) => {
    const from = self && t.createdBy && t.createdBy !== i.profile ? ` From ${i.nameOf(t.createdBy)}` : "";
    const body = self && t.status !== "done" && t.body.trim() ? `${from ? ":" : " Asked:"} "${clip(t.body, 160)}"` : "";
    return `- "${clip(t.title, 100)}" (${t.id})${self ? "" : ` → ${i.nameOf(t.assignee ?? "")}`}: ${state(t, i, self)}.${from}${body}`;
  };
  return [
    LIVE_HEAD,
    ...(open.length ? ["Your tasks on the board. Each runs in a session of its own; this chat knows only what is listed here.", ...open.map((t) => line(t, true))] : []),
    ...(done.length ? ["Done in the last day:", ...done.map((t) => line(t, true))] : []),
    ...(given.length ? ["Work you gave to others:", ...given.map((t) => line(t, false))] : []),
    "When the person asks about this work, answer from this list: what the run is doing, how long it has taken, and that its result will appear on the task in Tasks.",
  ].join("\n");
}
