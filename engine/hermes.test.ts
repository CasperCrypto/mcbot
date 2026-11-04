import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bundledHermes, chatArgv, findHermes, hermesCommand, prepareHermes } from "./hermes";

/**
 * A stand-in hermes/: its "Python" answers `-m pm.environments --format json` like Hermes' package
 * manager (dependencies only once the home is set up), and setup-hermes.sh sets a home up.
 */
function fakeHermesDir(withPython: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "mcbot-hermes-dir-"));
  mkdirSync(join(dir, "pm"));
  writeFileSync(join(dir, "hermes"), "");
  writeFileSync(join(dir, "setup-hermes.sh"), 'echo "→ Installing dependencies"\nmkdir -p "$HERMES_HOME" && touch "$HERMES_HOME/installed"\necho "✓ done"\n');
  if (withPython) {
    const py = join(dir, ".hermes-runtime", "python-3.14.9-linux-x64", "bin", "python3");
    mkdirSync(join(py, ".."), { recursive: true });
    writeFileSync(py, [
      "#!/usr/bin/env bash",
      'if [ "$1" = "-m" ] && [ "$2" = "pm.environments" ]; then',
      '  sp=""; [ -f "$HERMES_HOME/installed" ] && sp=":/venv/lib/python3.14/site-packages"',
      '  printf \'{"PYTHONPATH":"%s%s","PATH":"/rt/bin:%s","__HERMES_ACTIVATED":"%s/installs/x/facts.json","HERMES_HOME":"%s"}\' "$PYTHONPATH" "$sp" "$PATH" "$HERMES_HOME" "$HERMES_HOME"',
      "  exit 0",
      "fi",
      'echo "ran: $*"',
    ].join("\n"));
    chmodSync(py, 0o755);
  }
  return dir;
}

describe("McBot's own Hermes", () => {
  it("is used once its tools exist: its own Python running the hermes launcher", async () => {
    expect(bundledHermes({ MCBOT_HERMES_DIR: fakeHermesDir(false) })).toBeNull();
    const dir = fakeHermesDir(true);
    const bin = bundledHermes({ MCBOT_HERMES_DIR: dir })!;
    expect(bin).toMatchObject({ kind: "bundled", path: join(dir, ".hermes-runtime", "python-3.14.9-linux-x64", "bin", "python3"), prefix: [join(dir, "hermes")] });
    expect(bin.env).toEqual({ HERMES_RUNTIME_DIR: join(dir, ".hermes-runtime") }); // never HERMES_MANAGED: it stops Hermes creating its home
    expect(hermesCommand(bin, ["--version"], { HERMES_HOME: "/h" }).args).toEqual([join(dir, "hermes"), "--version"]);
    expect((await findHermes({ MCBOT_HERMES_DIR: dir, MCBOT_HERMES_BIN: "/bin/sh", PATH: "" }))?.kind).toBe("external");
    expect((await findHermes({ MCBOT_HERMES_DIR: dir, PATH: "" }))?.kind).toBe("bundled");
  });

  it("labels its runs mcbot; an external Hermes keeps the default", () => {
    expect(chatArgv("support", { kind: "bundled" })).toEqual(["-p", "support", "chat", "--query-file", "-", "--oneshot", "--format", "stream-json", "--source", "mcbot"]);
    expect(chatArgv("support", { kind: "external" })).not.toContain("--source");
  });

  it("sets a new home up once, then reuses its environment", async () => {
    const dir = fakeHermesDir(true);
    const home = join(mkdtempSync(join(tmpdir(), "mcbot-home-")), "hermes");
    const bin = bundledHermes({ MCBOT_HERMES_DIR: dir })!;
    const lines: string[] = [];
    const ready = await prepareHermes(bin, home, (l) => lines.push(l));
    expect(existsSync(join(home, "installed"))).toBe(true);
    expect(lines).toEqual(["Preparing Hermes for this home (first use)…", "→ Installing dependencies", "✓ done"]);
    expect(ready.env?.PYTHONPATH).toBe(`${dir}:/venv/lib/python3.14/site-packages`);
    expect(ready.env?.__HERMES_ACTIVATED).toBe(`${home}/installs/x/facts.json`);
    expect(ready.env).not.toHaveProperty("HERMES_HOME"); // each run sets its own

    const again: string[] = [];
    await prepareHermes(bin, home, (l) => again.push(l));
    expect(again).toEqual([]);
    expect(await prepareHermes({ path: "/usr/bin/hermes", shell: false, kind: "external" }, home)).toEqual({ path: "/usr/bin/hermes", shell: false, kind: "external" });
  });
});
