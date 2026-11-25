import type { RunSummary } from "../../contracts/run";

/**
 * The floating island: a small always-on-top window the desktop shell shows while McBot is hidden
 * or behind another app (src-tauri `island`). The main window owns the state and sends this summary;
 * the pill sends back what the person chose. Events only: the pill holds no board and no keys.
 */
export type IslandState =
  | { mode: "rest"; text: string; count: number }
  | { mode: "run"; text: string; count: number; seed: string }
  | { mode: "ask"; text: string; sub: string; count: number; seed: string; runId: string };

export type IslandAct =
  | { type: "open" }
  | { type: "hide" }
  | { type: "answer"; runId: string; choice: "once" | "deny" };

export const ISLAND_STATE = "island-state";
export const ISLAND_ACT = "island-act";
export const ISLAND_READY = "island-ready";

/** The one most important thing now: a question, else work in progress, else quiet. Pure. */
export function islandStateOf(runs: readonly RunSummary[], nameOf: (r: RunSummary) => string, count: number): IslandState {
  const running = runs.filter((r) => r.status === "running").sort((a, b) => a.startedAt - b.startedAt);
  const asking = running.find((r) => r.approval);
  if (asking) return { mode: "ask", text: `${nameOf(asking)} asks before acting`, sub: asking.approval!.command || asking.approval!.description, count, seed: asking.profile, runId: asking.runId };
  // A question is answered in McBot (its options, or typed): the pill says so and a click opens it.
  const question = running.find((r) => r.question);
  if (question) return { mode: "run", text: `${nameOf(question)} asks you: ${question.question!.question}`, count, seed: question.profile };
  if (running.length) {
    const first = running[0]!;
    return { mode: "run", text: running.length === 1 ? `${nameOf(first)} is working` : `${running.length} agents working`, count, seed: first.profile };
  }
  return { mode: "rest", text: count ? `${count} need${count === 1 ? "s" : ""} you` : "McBot", count };
}
