import { describe, expect, it } from "vitest";
import { engineVerdict } from "./engineHealth";

const s = (over: Partial<Parameters<typeof engineVerdict>[0] & object> = {}) => ({ bundled: true, running: true, exit: null, error: null, log: "", logPath: "/d/engine.log", ...over });

describe("what the window says while the engine is away", () => {
  it("waits quietly at first, then says it is still starting", () => {
    expect(engineVerdict(s(), 3000).kind).toBe("starting");
    expect(engineVerdict(s(), 25_000).kind).toBe("slow");
  });
  it("says at once when the engine stopped, and why when the port is taken", () => {
    expect(engineVerdict(s({ running: false, exit: "exit code 1" }), 2000)).toMatchObject({ kind: "stopped", title: "The engine stopped (exit code 1)" });
    expect(engineVerdict(s({ running: false, exit: "exit code 1", log: "McBot engine failed to start: Error: port 4317 is in use — is another McBot engine running?" }), 2000).kind).toBe("port");
  });
  it("points at the antivirus when the engine could not even be launched", () => {
    expect(engineVerdict(s({ running: false, error: "C:\\McBot\\mcbot-engine.exe: Access is denied. (os error 5)" }), 1000)).toMatchObject({ kind: "blocked", hint: expect.stringMatching(/antivirus/) });
  });
  it("outside the installed app it keeps the npm run dev hint", () => {
    expect(engineVerdict(null, 1000).kind).toBe("starting");
    expect(engineVerdict(null, 30_000)).toMatchObject({ kind: "dev", hint: "Start it with npm run dev." });
  });
});
