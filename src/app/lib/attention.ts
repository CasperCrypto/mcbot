import type { TaskView } from "../../contracts/api";
import type { RunSummary } from "../../contracts/run";

const DAY = 86_400_000;

/** What needs the person, counted the way Home's "Needs you" lists it. */
export function attentionCount(tasks: readonly TaskView[], runs: readonly RunSummary[], drift: number | null, now = Date.now()): number {
  const review = tasks.filter((t) => t.status === "review").length;
  const blocked = tasks.filter((t) => t.status === "blocked").length;
  const nobody = tasks.filter((t) => !t.assignee && t.status !== "done").length;
  const failed = Math.min(5, runs.filter((r) => r.status === "failed" && r.startedAt > now - DAY).length);
  return (drift ? 1 : 0) + review + blocked + nobody + failed;
}
