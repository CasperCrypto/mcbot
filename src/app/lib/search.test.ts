import { describe, expect, it } from "vitest";
import type { RunSummary } from "../../contracts/run";
import { searchRuns } from "./search";

const run = (id: string, at: number, prompt: string, text: string) => ({ runId: id, startedAt: at, prompt, text, error: null }) as unknown as RunSummary;

describe("searching past conversations", () => {
  const runs = [
    run("a", 1, "Plan the launch", "We ship the glass UI on Friday after the review."),
    run("b", 2, "Summarise sales", "Sales grew 12% in October."),
    run("c", 3, "What about the launch date?", "Friday."),
  ];
  it("finds every word in the question or the answer, newest first", () => {
    expect(searchRuns(runs, "launch").map((h) => h.run.runId)).toEqual(["c", "a"]);
    expect(searchRuns(runs, "launch glass").map((h) => h.run.runId)).toEqual(["a"]);
    expect(searchRuns(runs, "october SALES").map((h) => h.run.runId)).toEqual(["b"]);
  });
  it("shows the answer around the match, and ignores one-letter queries", () => {
    expect(searchRuns(runs, "review")[0]!.snippet).toContain("review");
    expect(searchRuns(runs, "a")).toEqual([]);
  });
});
