import type { resolveGraph } from "../../compile";

/**
 * Where a click on a part of the Hermes picture takes you: the block that makes it, on the Board
 * (agent, model, tool, maker, chat app), or the view that owns it (memory, schedules, tasks), or
 * the engine's settings (gateway, approvals). The picture stays read-only; editing happens where
 * the part comes from, so what you change is what compiles.
 */
export function hermesTarget(id: string, bundles: ReturnType<typeof resolveGraph>["bundles"]): { node: string } | { tab: "memory" | "home" | "tasks" | "settings" } | null {
  if (id.startsWith("in:") && id !== "in:mcbot") return { node: id.slice(3) };
  if (id === "gateway" || id === "approvals" || id === "in:mcbot") return { tab: "settings" };
  if (id === "kanban") return { tab: "tasks" };
  const m = /^agent:(.+?)(?::(model|abilities|tools|makers|skills|memory|cron))?$/.exec(id);
  if (!m) return null;
  const b = bundles.find((x) => x.agent.id === m[1]);
  if (!b) return null;
  switch (m[2]) {
    case "model": return { node: b.models[0]?.id ?? b.agent.id };
    case "tools": return { node: b.tools[0]?.id ?? b.agent.id };
    case "makers": return { node: (b.image ?? b.video)?.id ?? b.agent.id };
    case "memory": return { tab: "memory" };
    case "cron": return { tab: "home" };
    default: return { node: b.agent.id };
  }
}
