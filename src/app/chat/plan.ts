/**
 * The plan an agent is working through, from Hermes' to-do tool (`todo_list`, hermes/tools/todo_tool.py):
 * every call returns the whole list (`{"todos": [{id, content, status, parent?}], ...}`), so the
 * newest result is the plan now. A call through Hermes' `tool_call` bridge carries the same result.
 * Pure: a run's events in, the plan out (null when the agent made none).
 */
import type { RunEvent } from "../../contracts/run";

export type PlanStatus = "pending" | "in_progress" | "completed" | "cancelled";
export interface PlanItem { id: string; content: string; status: PlanStatus; parent?: string }

const STATUSES = new Set<PlanStatus>(["pending", "in_progress", "completed", "cancelled"]);

function items(value: unknown): PlanItem[] | null {
  const todos = (value as { todos?: unknown } | null)?.todos;
  if (!Array.isArray(todos)) return null;
  const out: PlanItem[] = [];
  for (const t of todos) {
    if (!t || typeof t !== "object") continue;
    const { id, content, status, parent } = t as Record<string, unknown>;
    if (typeof content !== "string" || !content.trim()) continue;
    out.push({
      id: typeof id === "string" ? id : String(out.length + 1),
      content: content.trim(),
      status: typeof status === "string" && STATUSES.has(status as PlanStatus) ? (status as PlanStatus) : "pending",
      ...(typeof parent === "string" && parent ? { parent } : {}),
    });
  }
  return out;
}

const isTodo = (tool: string) => /(^|_)todo(_list)?$/.test(tool) || tool === "todo_list";

/** The newest plan in a run, or null. */
export function planOf(events: readonly RunEvent[] | undefined): PlanItem[] | null {
  if (!events) return null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === "run.tool.finished") {
      // Its result is the whole list (also through the tool_call bridge, whatever the name says).
      let parsed: unknown = null;
      try { parsed = JSON.parse(e.output); } catch { continue; }
      const list = items(parsed);
      if (list && (isTodo(e.tool) || list.length)) return list;
    } else if (e.type === "run.tool.started") {
      const input = e.input as { name?: unknown; arguments?: unknown; merge?: unknown } | undefined;
      const inner = e.tool === "tool_call" && input?.name === "todo_list" ? input.arguments : isTodo(e.tool) ? input : null;
      // A fresh plan (not a merge) shows before its result arrives.
      if (inner && !(inner as { merge?: unknown }).merge) {
        const list = items(inner);
        if (list?.length) return list;
      }
    }
  }
  return null;
}

/** Whether a step is the to-do tool (its plan is drawn on its own, not as a step). */
export function isPlanStep(e: Extract<RunEvent, { type: "run.tool.started" }>): boolean {
  if (isTodo(e.tool)) return true;
  return e.tool === "tool_call" && (e.input as { name?: unknown } | undefined)?.name === "todo_list";
}
