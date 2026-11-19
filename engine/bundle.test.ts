import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bundleStamp, installBundledHermes } from "./bundle";

describe("the shipped Hermes", () => {
  it("is copied to a writable folder once per version", () => {
    const bundle = mkdtempSync(join(tmpdir(), "mcbot-bundle-"));
    mkdirSync(join(bundle, "agent"));
    writeFileSync(join(bundle, "UPSTREAM.json"), '{"commit":"abc"}');
    writeFileSync(join(bundle, "MCBOT.md"), "changes");
    writeFileSync(join(bundle, "agent", "x.py"), "print(1)");
    const data = mkdtempSync(join(tmpdir(), "mcbot-data-"));

    const dir = installBundledHermes(bundle, data);
    expect(dir).toBe(join(data, `hermes-${bundleStamp(bundle)}`));
    expect(readFileSync(join(dir, "agent", "x.py"), "utf8")).toBe("print(1)");
    writeFileSync(join(dir, "agent", "x.py"), "edited by a run"); // Hermes may write next to its code
    expect(installBundledHermes(bundle, data)).toBe(dir); // already installed: left alone
    expect(readFileSync(join(dir, "agent", "x.py"), "utf8")).toBe("edited by a run");

    writeFileSync(join(bundle, "MCBOT.md"), "more changes"); // a McBot update with a new Hermes
    const next = installBundledHermes(bundle, data);
    expect(next).not.toBe(dir);
    expect(existsSync(join(next, ".mcbot-installed"))).toBe(true);
  });
});

describe("the shipped Hermes on a locked folder (Windows EBUSY)", () => {
  it("steps around an unfinished copy it can't remove, and finds that copy next time", async () => {
    const { renameSync, rmSync } = await import("node:fs");
    const bundle = mkdtempSync(join(tmpdir(), "mcbot-bundle-"));
    writeFileSync(join(bundle, "UPSTREAM.json"), '{"commit":"abc"}');
    writeFileSync(join(bundle, "MCBOT.md"), "changes");
    writeFileSync(join(bundle, "x.py"), "print(1)");
    const data = mkdtempSync(join(tmpdir(), "mcbot-data-"));
    const base = join(data, `hermes-${bundleStamp(bundle)}`);
    mkdirSync(base); // an earlier copy that never finished (no marker), held open by a process
    const busy = Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
    const fs = {
      rm: (p: string) => { if (p === base) throw busy; rmSync(p, { recursive: true, force: true }); },
      rename: (a: string, b: string) => renameSync(a, b),
    };
    const dir = installBundledHermes(bundle, data, fs);
    expect(dir).toBe(`${base}-2`);
    expect(readFileSync(join(dir, "x.py"), "utf8")).toBe("print(1)");
    expect(installBundledHermes(bundle, data, fs)).toBe(dir); // next start: the finished copy, no new one
  });
  it("still fails loudly on an error that isn't a lock", () => {
    const bundle = mkdtempSync(join(tmpdir(), "mcbot-bundle-"));
    writeFileSync(join(bundle, "MCBOT.md"), "x");
    const data = mkdtempSync(join(tmpdir(), "mcbot-data-"));
    const full = Object.assign(new Error("ENOSPC: no space left"), { code: "ENOSPC" });
    expect(() => installBundledHermes(bundle, data, { rm: () => undefined, rename: () => { throw full; } })).toThrow(/ENOSPC/);
  });
});
