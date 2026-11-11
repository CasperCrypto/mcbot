import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { bundledHermes, chatArgv, findHermes, hermesCommand, prepareHermes, setupEnv, setupHome } from "./hermes";

/**
 * A stand-in hermes/: its "Python" answers `-m pm.environments --format json` like Hermes' package
 * manager (dependencies only once the home is set up), and setup-hermes.sh sets a home up.
 */
function fakeHermesDir(withPython: boolean, setupSeconds = 0): string {
  const dir = mkdtempSync(join(tmpdir(), "mcbot-hermes-dir-"));
  mkdirSync(join(dir, "pm"));
  writeFileSync(join(dir, "hermes"), "");
  writeFileSync(join(dir, "setup-hermes.sh"), [
    'echo "→ Installing dependencies"',
    'mkdir -p "$HERMES_HOME" && echo x >> "$HERMES_HOME/setups"',
    ...(setupSeconds ? [`sleep ${setupSeconds}`] : []),
    'touch "$HERMES_HOME/installed"',
    'echo "✓ done"',
    "",
  ].join("\n"));
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

  it("makes a run that starts during first-launch preparation wait for it, not set the home up twice", async () => {
    const dir = fakeHermesDir(true, 0.4);
    const home = join(mkdtempSync(join(tmpdir(), "mcbot-home-")), "hermes");
    const bin = bundledHermes({ MCBOT_HERMES_DIR: dir })!;
    const setupLines: string[] = [];
    const preparing = setupHome({ dir, runtime: join(dir, ".hermes-runtime") }, home, (l) => setupLines.push(l));
    await new Promise((r) => setTimeout(r, 100)); // the setup assistant's Prepare is under way
    const runLines: string[] = [];
    const [run, setup] = await Promise.all([prepareHermes(bin, home, (l) => runLines.push(l)), preparing]);
    expect(readFileSync(join(home, "setups"), "utf8")).toBe("x\n"); // Hermes' setup ran once
    expect(runLines).toEqual(["Waiting for the engine to finish preparing…"]);
    expect(setupLines).toEqual(["→ Installing dependencies", "✓ done"]);
    expect(run.env?.PYTHONPATH).toBe(`${dir}:/venv/lib/python3.14/site-packages`);
    expect(setup?.env?.PYTHONPATH).toBe(run.env?.PYTHONPATH);
  });

  it("runs Hermes' setup again when Prepare is asked for after a ready home", async () => {
    const dir = fakeHermesDir(true);
    const home = join(mkdtempSync(join(tmpdir(), "mcbot-home-")), "hermes");
    const src = { dir, runtime: join(dir, ".hermes-runtime") };
    expect((await setupHome(src, home, () => undefined))?.env?.PYTHONPATH).toContain("site-packages");
    expect((await setupHome(src, home, () => undefined))?.env?.PYTHONPATH).toContain("site-packages");
    expect(readFileSync(join(home, "setups"), "utf8")).toBe("x\nx\n");
  });

  it("lets Windows PowerShell find its own modules when McBot was started from PowerShell 7", () => {
    const base = { PATH: "C:\\Windows", PSModulePath: "C:\\Program Files\\PowerShell\\7\\Modules", PYTHONPATH: "x" };
    const win = setupEnv({ runtime: "R" }, "H", base, "win32");
    expect(win).not.toHaveProperty("PSModulePath");
    expect(win).toMatchObject({ PATH: "C:\\Windows", HERMES_RUNTIME_DIR: "R", HERMES_HOME: "H", PYTHONPATH: "" });
    expect(setupEnv({ runtime: "R" }, "H", { psmodulepath: "x" }, "win32")).not.toHaveProperty("psmodulepath");
    expect(setupEnv({ runtime: "R" }, "H", base, "darwin")).toHaveProperty("PSModulePath"); // only Windows changes
  });
});
