import { describe, expect, it } from "vitest";
import type { RunEvent } from "../../contracts/run";
import { screenCaptures } from "./screen";

const base = { v: 1, runId: "run_x_1", ts: 0 } as const;
const started = (seq: number, input: unknown) => ({ ...base, seq, type: "run.tool.started", tool: "computer_use", input, toolNodeId: null }) as unknown as RunEvent;
const finished = (seq: number, output: string, tool = "computer_use", isError = false) => ({ ...base, seq, type: "run.tool.finished", tool, output, durationMs: 5, isError, toolNodeId: null }) as unknown as RunEvent;

describe("the agent's screen", () => {
  it("collects each capture with the step that led to it", () => {
    const events = [
      started(1, { action: "capture", mode: "som" }),
      finished(2, '{"verdict":"ok","screenshot_path":"/Users/me/McBot/hermes/profiles/ops/cache/images/computer_use_ab.png","elements":[{"index":1'),
      started(3, { action: "click", element: 7 }),
      finished(4, "clicked; shareable screenshot saved to C:\\Users\\me\\cache\\images\\computer_use_cd.png"),
      finished(5, '{"screenshot_path":"/x.png"}', "computer_use", true),
      finished(6, '{"image":"/y.png"}', "image_generate"),
    ];
    expect(screenCaptures(events)).toEqual([
      { path: "/Users/me/McBot/hermes/profiles/ops/cache/images/computer_use_ab.png", seq: 2, action: "capture" },
      { path: "C:\\Users\\me\\cache\\images\\computer_use_cd.png", seq: 4, action: "click #7" },
    ]);
  });

  it("reads a Windows path escaped in JSON", () => {
    // JSON doubles each backslash; the path itself has one.
    expect(screenCaptures([finished(1, '{"screenshot_path":"C:\\\\Users\\\\me\\\\a.png"}')])[0]!.path).toBe("C:\\Users\\me\\a.png");
  });
});
