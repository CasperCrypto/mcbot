import { useEffect, useRef } from "react";
import type { TaskView } from "../../contracts/api";
import type { AgentNode } from "../../contracts/graph";
import type { RunSummary } from "../../contracts/run";
import { attentionCount } from "../lib/attention";
import { notify, setAttention } from "../lib/desktop";

/**
 * Keep the menu bar count current, and notify when an agent finishes or a task changes in a way
 * that needs the person. Only changes seen while the app runs notify: the first look is a baseline.
 */
export function useSignals(tasks: readonly TaskView[] | null, runs: Record<string, RunSummary>, drift: number | null, agents: readonly AgentNode[]): void {
  const seenRuns = useRef<Map<string, string> | null>(null);
  const seenTasks = useRef<Map<string, string> | null>(null);
  const nameOf = (profile: string | null) => {
    const a = agents.find((x) => x.data.name === profile);
    return a ? a.data.displayName || a.data.name : profile ?? "An agent";
  };

  useEffect(() => {
    void setAttention(attentionCount(tasks ?? [], Object.values(runs), drift));
  }, [tasks, runs, drift]);

  useEffect(() => {
    const before = seenRuns.current;
    seenRuns.current = new Map(Object.values(runs).map((r) => [r.runId, r.status]));
    if (!before) return;
    for (const r of Object.values(runs)) {
      if (before.get(r.runId) !== "running" || r.status === "running") continue;
      if (r.status === "succeeded") void notify(`${nameOf(r.profile)} answered`, r.text.split("\n")[0] || r.prompt);
      if (r.status === "failed") void notify(`${nameOf(r.profile)} failed`, r.error ?? r.prompt);
    }
  }, [runs]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!tasks) return;
    const before = seenTasks.current;
    seenTasks.current = new Map(tasks.map((t) => [t.id, t.status]));
    if (!before) return;
    for (const t of tasks) {
      const was = before.get(t.id);
      if (was === t.status) continue;
      if (t.status === "review") void notify(`${nameOf(t.assignee)} asks for a review`, t.title);
      else if (t.status === "blocked") void notify(`${nameOf(t.assignee)} is blocked`, t.error ?? t.title);
      else if (t.status === "done" && was) void notify(`${nameOf(t.assignee)} finished a task`, t.title);
    }
  }, [tasks]); // eslint-disable-line react-hooks/exhaustive-deps
}
