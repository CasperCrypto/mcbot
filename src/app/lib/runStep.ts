import type { RunEvent } from "../../contracts/run";
import { toolLabel } from "./toolLabel";

/** What a running agent is doing right now, in two or three words, from its run's events. */
export function stepOf(events: readonly RunEvent[] | undefined): string {
  if (!events?.length) return "Starting";
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === "run.approval") return "Waiting for you";
    if (e.type === "run.approval.settled") return "Thinking";
    if (e.type === "run.tool.started") return toolLabel(e.tool);
    if (e.type === "run.tool.finished") return "Thinking";
    if (e.type === "run.text") return "Writing";
  }
  return "Thinking";
}
