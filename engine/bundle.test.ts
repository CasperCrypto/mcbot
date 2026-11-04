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
