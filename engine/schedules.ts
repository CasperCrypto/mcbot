/**
 * Schedules: Hermes' cron jobs. Each profile owns its own store, `<profile>/cron/jobs.json`
 * (cron/jobs.py: "Cron is per-profile by design"), and its jobs run while a gateway serves that
 * profile. Reads go to jobs.json; changes go through `hermes -p <agent> cron …`.
 */
import { readFile } from "node:fs/promises";
import type { ScheduleView } from "../src/contracts/api";
import { resolveInside } from "./fsutil";

type Job = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const time = (v: unknown): number | null => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** `{ jobs: [...] }` as cron/jobs.py writes it (`save_jobs`). */
export function parseJobs(raw: string): ScheduleView[] {
  let data: { jobs?: unknown };
  try {
    data = JSON.parse(raw) as { jobs?: unknown };
  } catch {
    return [];
  }
  return (Array.isArray(data.jobs) ? (data.jobs as Job[]) : []).filter((j) => typeof j.id === "string").map((j) => {
    const schedule = (j.schedule ?? {}) as Job;
    return {
      id: String(j.id),
      name: str(j.name) ?? "",
      prompt: str(j.prompt) ?? "",
      when: str(j.schedule_display) ?? str(schedule.display) ?? str(schedule.expr) ?? "",
      enabled: j.enabled !== false,
      state: str(j.state) ?? "scheduled",
      nextRunAt: time(j.next_run_at),
      lastRunAt: time(j.last_run_at),
      lastStatus: str(j.last_status),
      lastError: str(j.last_error),
    };
  });
}

export async function readSchedules(root: string, profile: string): Promise<ScheduleView[]> {
  try {
    return parseJobs(await readFile(resolveInside(root, `profiles/${profile}/cron/jobs.json`), "utf8"));
  } catch {
    return [];
  }
}

/** Hermes' job ids: 12 hex (cron/jobs.py `create_job`). */
export const JOB_ID_RE = /^[a-f0-9]{6,32}$/;

/** `hermes -p <agent> cron create --name <name> -- <schedule> <prompt>` (hermes_cli/subcommands/cron.py). */
export function createScheduleArgv(profile: string, when: string, prompt: string, name: string): string[] {
  return ["-p", profile, "cron", "create", ...(name ? ["--name", name] : []), "--", when, prompt];
}

export type ScheduleAction = "pause" | "resume" | "run" | "remove";

export function scheduleActionArgv(profile: string, id: string, action: ScheduleAction): string[] {
  return ["-p", profile, "cron", action, id];
}
