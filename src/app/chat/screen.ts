import type { RunEvent } from "../../contracts/run";

/**
 * What an agent saw while it used the computer: every capture of Hermes' computer_use tool carries
 * a `screenshot_path` in its result (tools/computer_use/tool.py `_persist_capture_image`, saved in
 * the agent's own cache), and the step it took is in the call's input. Read loosely: a long result
 * may arrive cut short.
 */
export function screenCaptures(events: RunEvent[] | undefined): { path: string; seq: number; action: string }[] {
  const out: { path: string; seq: number; action: string }[] = [];
  let action = "";
  for (const e of events ?? []) {
    if (e.type === "run.tool.started" && e.tool === "computer_use") {
      const i = (e.input ?? {}) as Record<string, unknown>;
      action = [i.action, i.element !== undefined ? `#${String(i.element)}` : "", typeof i.text === "string" ? `"${i.text.slice(0, 40)}"` : "", typeof i.key === "string" ? i.key : ""].filter(Boolean).join(" ");
    }
    if (e.type !== "run.tool.finished" || e.tool !== "computer_use" || e.isError) continue;
    const m = /"screenshot_path"\s*:\s*"((?:[^"\\]|\\.)+)"/.exec(e.output) ?? /screenshot saved to (\S+\.(?:png|jpe?g|webp))/i.exec(e.output);
    if (m) out.push({ path: m[1]!.replace(/\\\\/g, "\\"), seq: e.seq, action });
  }
  return out;
}
