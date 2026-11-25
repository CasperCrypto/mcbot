import { describe, expect, it } from "vitest";
import { runError } from "./runError";

describe("runError", () => {
  it("says Hermes' codes in words", () => {
    expect(runError("runtime_draining")).toBe("The engine was restarting");
    expect(runError("Gateway is draining existing work; retry shortly.")).toBe("The engine was restarting");
    expect(runError("Lost the run's events: fetch failed")).toBe("Couldn't reach the engine");
    expect(runError("Error code: 401 - invalid api key")).toBe("The model's key was refused");
    expect(runError("429 Too Many Requests")).toBe("The model is rate limited");
  });

  it("keeps any other reason, and has one for none", () => {
    expect(runError("Unknown profile")).toBe("Unknown profile");
    expect(runError(null)).toBe("See the run");
    expect(runError("  ")).toBe("See the run");
  });
});
