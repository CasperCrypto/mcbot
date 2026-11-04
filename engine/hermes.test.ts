import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bundledHermes, chatArgv, findHermes, hermesCommand, prepareHermes } from "./hermes";

/** A stand-in hermes/ checkout: the runner prints its environment like Hermes' does. */
function fakeHermesDir(withPython: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "mcbot-hermes-dir-"));
  mkdirSync(join(dir, "scripts"));
  writeFileSync(join(dir, "hermes"), "");
  writeFileSync(join(dir, "scripts", "run-in-hermes-env"), '#!/usr/bin/env bash\nexport __HERMES_ACTIVATED=/x/facts.json\nexport PATH="/runtime/bin:$PATH"\nexec "$@"\n');
  chmodSync(join(dir, "scripts", "run-in-hermes-env"), 0o755);
  if (withPython) mkdirSync(join(dir, ".hermes-runtime", "python-3.14.9-linux-x64"), { recursive: true });
  return dir;
}

describe("McBot's own Hermes", () => {
  it("is used once its runtime exists, managed by McBot, through Hermes' runner", async () => {
    expect(bundledHermes({ MCBOT_HERMES_DIR: fakeHermesDir(false) })).toBeNull();
    const dir = fakeHermesDir(true);
    const bin = bundledHermes({ MCBOT_HERMES_DIR: dir })!;
    expect(bin).toMatchObject({ kind: "bundled", path: "bash", env: { HERMES_RUNTIME_DIR: join(dir, ".hermes-runtime") } });
    expect(bin.env).not.toHaveProperty("HERMES_MANAGED"); // it would stop Hermes creating its home
    expect(hermesCommand(bin, ["--version"], { HERMES_HOME: "/h" }).args).toEqual([join(dir, "scripts", "run-in-hermes-env"), "python3", join(dir, "hermes"), "--version"]);
    // An explicit binary still wins.
    expect((await findHermes({ MCBOT_HERMES_DIR: dir, MCBOT_HERMES_BIN: "/bin/sh", PATH: "" }))?.kind).toBe("external");
    expect((await findHermes({ MCBOT_HERMES_DIR: dir, PATH: "" }))?.kind).toBe("bundled");
  });

  it("labels its runs mcbot; an external Hermes keeps the default", () => {
    expect(chatArgv("support", { kind: "bundled" })).toEqual(["-p", "support", "chat", "--query-file", "-", "--oneshot", "--format", "stream-json", "--source", "mcbot"]);
    expect(chatArgv("support", { kind: "external" })).not.toContain("--source");
  });

  it("activates once and passes on only what the runner added", async () => {
    const bin = bundledHermes({ MCBOT_HERMES_DIR: fakeHermesDir(true) })!;
    const ready = await prepareHermes(bin, "/tmp/agents-home");
    expect(ready.env?.__HERMES_ACTIVATED).toBe("/x/facts.json");
    expect(ready.env?.PATH?.startsWith("/runtime/bin:")).toBe(true);
    expect(Object.keys(ready.env ?? {}).sort()).toEqual(["HERMES_RUNTIME_DIR", "PATH", "__HERMES_ACTIVATED"]);
    expect(await prepareHermes({ path: "/usr/bin/hermes", shell: false, kind: "external" }, "/h")).toEqual({ path: "/usr/bin/hermes", shell: false, kind: "external" });
  });
});
