import { describe, expect, it } from "vitest";
import { taskNote } from "./taskNote";

describe("why a task that works until done stopped", () => {
  it("says it plainly instead of Hermes' words", () => {
    expect(taskNote("Goal-mode worker exhausted its turn budget (20/20) without completing the task. Last judge verdict: the export button is missing")).toBe("Not done after 20 rounds. Still missing: the export button is missing");
    expect(taskNote("Goal-mode judge ruled the goal unachievable: needs a paid account")).toBe("Can't be done as asked: needs a paid account");
    expect(taskNote("Goal-mode worker's output looked complete but it never called kanban_complete after a finalize nudge (all parts done).")).toBe("Looks done. Check it, then mark it done.");
  });

  it("keeps anyone else's words", () => {
    expect(taskNote("Sent the draft to Sam")).toBe("Sent the draft to Sam");
  });
});
