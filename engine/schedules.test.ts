import { describe, expect, it } from "vitest";
import { createScheduleArgv, parseJobs, scheduleActionArgv } from "./schedules";

describe("schedules (Hermes cron)", () => {
  it("reads jobs.json as Hermes writes it", () => {
    // A job `hermes -p triage cron create "0 9 * * 1-5" … --name "Morning digest"` wrote (trimmed).
    const raw = JSON.stringify({
      jobs: [{
        id: "e8914842738e", name: "Morning digest", prompt: "Summarise new tickets", schedule: { kind: "cron", expr: "0 9 * * 1-5", display: "0 9 * * 1-5" },
        schedule_display: "0 9 * * 1-5", enabled: true, state: "scheduled", next_run_at: "2026-11-12T09:00:00+00:00", last_run_at: null, last_status: null, last_error: null,
      }, { id: "aaaaaaaaaaaa", prompt: "Ping", schedule: { kind: "interval", display: "every 2h" }, enabled: false, state: "paused", last_status: "error", last_error: "boom" }],
      updated_at: "2026-11-11T18:04:53.510850+00:00",
    });
    expect(parseJobs(raw)).toEqual([
      { id: "e8914842738e", name: "Morning digest", prompt: "Summarise new tickets", when: "0 9 * * 1-5", enabled: true, state: "scheduled", nextRunAt: Date.parse("2026-11-12T09:00:00Z"), lastRunAt: null, lastStatus: null, lastError: null },
      { id: "aaaaaaaaaaaa", name: "", prompt: "Ping", when: "every 2h", enabled: false, state: "paused", nextRunAt: null, lastRunAt: null, lastStatus: "error", lastError: "boom" },
    ]);
    expect(parseJobs("not json")).toEqual([]);
  });

  it("builds Hermes' cron commands, free text after --", () => {
    expect(createScheduleArgv("triage", "0 9 * * 1-5", "--sweep the inbox", "Sweep")).toEqual(["-p", "triage", "cron", "create", "--name", "Sweep", "--", "0 9 * * 1-5", "--sweep the inbox"]);
    expect(scheduleActionArgv("triage", "e8914842738e", "pause")).toEqual(["-p", "triage", "cron", "pause", "e8914842738e"]);
  });
});
