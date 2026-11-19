/**
 * What the window says while it can't reach the engine: from what the shell knows (src-tauri
 * `engine_status`: running, how it ended, the end of engine.log) and how long the window has waited.
 * Pure (tested): the screen in App.tsx only draws it.
 */
import type { EngineStatus } from "./desktop";

export type EngineVerdict =
  | { kind: "starting" }
  | { kind: "slow" | "stopped" | "blocked" | "port" | "dev"; title: string; hint: string };

/** How long a starting engine may stay silent before the window says more than "Starting…". */
export const PATIENCE_MS = 20_000;

export function engineVerdict(status: EngineStatus | null, waitedMs: number): EngineVerdict {
  if (!status || !status.bundled) {
    // A browser tab or `tauri dev`: the engine is `npm run dev`'s.
    return waitedMs < PATIENCE_MS ? { kind: "starting" } : { kind: "dev", title: "McBot Studio's engine didn't start", hint: "Start it with npm run dev." };
  }
  if (status.error) {
    const blocked = /denied|permission|os error (5|13|225|1260)\b|virus|not found|cannot find|no such file/i.test(status.error);
    return {
      kind: "blocked", title: "The engine couldn't start",
      hint: blocked ? "Your antivirus or system may have blocked mcbot-engine. Allow it, then restart the engine." : "Restart the engine. If it happens again, copy the details into an issue.",
    };
  }
  if (!status.running) {
    if (/port \d+ is in use|EADDRINUSE/i.test(status.log)) {
      return { kind: "port", title: "Another program is using McBot's port", hint: "Quit any other copy of McBot Studio (or an old engine still running), then restart the engine." };
    }
    if (status.exit) return { kind: "stopped", title: `The engine stopped (${status.exit})`, hint: "Restart it. If it stops again, copy the details into an issue." };
  }
  if (waitedMs < PATIENCE_MS) return { kind: "starting" };
  return { kind: "slow", title: "The engine is still starting", hint: "The first start after installing copies Hermes and can take a few minutes. It opens by itself." };
}

/** Everything to paste into an issue. */
export function engineDetails(v: EngineVerdict, s: EngineStatus | null): string {
  return [
    "kind" in v && v.kind !== "starting" ? v.title : "Starting",
    s?.error ? `Error: ${s.error}` : "",
    s?.exit ? `Ended: ${s.exit}` : "",
    s?.logPath ? `Log: ${s.logPath}` : "",
    s?.log ? `\n${s.log}` : "",
  ].filter(Boolean).join("\n");
}
