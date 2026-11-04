/**
 * Everything the engine knows about invoking Hermes. Every flag here was
 * checked against `hermes --help` and the Hermes source (docs/HERMES.md).
 */
import { execFile, spawn } from "node:child_process";
import { constants, existsSync, readdirSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface HermesBinary {
  path: string;
  /** .cmd/.bat shims need a shell on Windows. */
  shell: boolean;
  /** Arguments before Hermes' own (the in-repo copy runs through its dev runner). */
  prefix?: string[];
  /** Extra environment for every Hermes process. */
  env?: Record<string, string>;
  /** "bundled": McBot's own copy in hermes/ (our fork); "external": an install found elsewhere. */
  kind: "bundled" | "external";
}

/** hermes/ next to engine/: McBot's fork of Hermes Agent (docs/MERGE.md). */
export const BUNDLED_HERMES_DIR = resolve(fileURLToPath(new URL("../hermes", import.meta.url)));

/**
 * The copy of Hermes inside McBot, once its Python environment exists (`npm run hermes:setup`).
 * It runs through Hermes' own dev runner, with its tools in hermes/.hermes-runtime. Runs do NOT
 * set HERMES_MANAGED: a managed install stops creating its home's folders and securing them
 * (hermes_cli/config_home.py `initialize_home`). Only the terminal launcher sets it, so
 * `hermes update` there says updates come with McBot (scripts/hermes.sh).
 */
export function bundledHermes(env: NodeJS.ProcessEnv = process.env): HermesBinary | null {
  const dir = env.MCBOT_HERMES_DIR?.trim() || BUNDLED_HERMES_DIR;
  const runner = join(dir, "scripts", "run-in-hermes-env");
  if (!existsSync(join(dir, "hermes")) || !existsSync(runner)) return null;
  // Ready once Hermes' package manager has put a Python in the tool store (scripts/_activation.sh
  // `hermes_bootstrap_python`); before that the first run would spend minutes installing.
  const runtime = env.HERMES_RUNTIME_DIR?.trim() || join(dir, ".hermes-runtime");
  if (!hasPython(runtime)) return null;
  return {
    path: "bash", shell: false, kind: "bundled",
    prefix: [runner, "python3", join(dir, "hermes")],
    env: { HERMES_RUNTIME_DIR: runtime },
  };
}

function hasPython(store: string): boolean {
  try {
    return readdirSync(store).some((d) => d.startsWith("python-"));
  } catch {
    return false;
  }
}

const activations = new Map<string, Promise<Record<string, string> | null>>();

/**
 * McBot's own Hermes, activated: its runner (`run-in-hermes-env`) checks and, if needed, builds
 * Hermes' environment on every launch unless the caller already carries an activation
 * (`__HERMES_ACTIVATED`, scripts/_activation.sh). Activate once per Hermes home — the installed
 * environment is registered under `<home>/installs/` — with `run-in-hermes-env env -0`, and pass on
 * what the runner added, so each run starts in 0.2 s instead of 2.6 s. A stale activation (after a
 * Hermes update) just makes the runner rebuild once.
 */
export async function prepareHermes(bin: HermesBinary, home: string): Promise<HermesBinary> {
  if (bin.kind !== "bundled" || !bin.prefix?.[0]) return bin;
  const runner = bin.prefix[0];
  const key = `${runner}\0${home}\0${JSON.stringify(bin.env ?? {})}`;
  let act = activations.get(key);
  if (!act) {
    const base: NodeJS.ProcessEnv = { ...process.env, ...bin.env, HERMES_HOME: home };
    act = new Promise((resolve) => {
      execFile("bash", [runner, "env", "-0"], { env: base, maxBuffer: 16 << 20, timeout: 15 * 60_000, windowsHide: true }, (err, stdout) => {
        if (err) return resolve(null);
        const added: Record<string, string> = {};
        for (const kv of stdout.split("\0")) {
          const i = kv.indexOf("=");
          if (i > 0 && kv.slice(0, i) !== "HERMES_HOME" && base[kv.slice(0, i)] !== kv.slice(i + 1)) added[kv.slice(0, i)] = kv.slice(i + 1);
        }
        resolve(added);
      });
    });
    activations.set(key, act);
    void act.then((a) => { if (!a) activations.delete(key); }); // try again next time
  }
  const added = await act;
  return added ? { ...bin, env: { ...bin.env, ...added } } : bin;
}

/** How to start Hermes with `argv`, and the environment it needs. */
export function hermesCommand(bin: HermesBinary, argv: string[], env: NodeJS.ProcessEnv): { file: string; args: string[]; env: NodeJS.ProcessEnv } {
  return { file: bin.path, args: [...(bin.prefix ?? []), ...argv], env: { ...env, ...bin.env } };
}

async function executable(p: string): Promise<boolean> {
  try {
    await access(p, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** MCBOT_HERMES_BIN, else McBot's own copy (hermes/), else the first `hermes` on PATH (PATHEXT-aware on Windows). */
export async function findHermes(env: NodeJS.ProcessEnv = process.env): Promise<HermesBinary | null> {
  const explicit = env.MCBOT_HERMES_BIN?.trim();
  const isShim = (p: string) => /\.(cmd|bat)$/i.test(p);
  if (explicit) return (await executable(explicit)) ? { path: explicit, shell: isShim(explicit), kind: "external" } : null;
  const own = bundledHermes(env);
  if (own) return own;
  const exts = process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").map((e) => e.toLowerCase()) : [""];
  for (const dir of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = join(dir, `hermes${ext}`);
      if (await executable(candidate)) return { path: candidate, shell: isShim(candidate), kind: "external" };
    }
  }
  return null;
}

/**
 * argv for one headless turn: `hermes -p <profile> chat --query-file - --oneshot --format stream-json`.
 * The prompt goes on stdin (--query-file -) so nothing is shell-interpreted. McBot's own Hermes
 * also gets `--source mcbot` (our fork adds that label: gateway/session_policy.py); an external
 * Hermes refuses unknown sources, so its runs keep the default `oneshot`.
 */
export function chatArgv(profile: string, bin?: Pick<HermesBinary, "kind">): string[] {
  const argv = ["-p", profile, "chat", "--query-file", "-", "--oneshot", "--format", "stream-json"];
  return bin?.kind === "bundled" ? [...argv, "--source", "mcbot"] : argv;
}

export function hermesEnv(root: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...base, HERMES_HOME: root };
}

/** hermes/UPSTREAM.json, written by scripts/hermes-sync.ts. */
export async function bundledUpstream(env: NodeJS.ProcessEnv = process.env): Promise<{ url: string; commit: string; date: string } | null> {
  const dir = env.MCBOT_HERMES_DIR?.trim() || BUNDLED_HERMES_DIR;
  try {
    const r = JSON.parse(await readFile(join(dir, "UPSTREAM.json"), "utf8")) as { upstream?: string; commit?: string; date?: string };
    return r.commit ? { url: r.upstream ?? "", commit: r.commit, date: r.date ?? "" } : null;
  } catch {
    return null;
  }
}

/** Is the gateway under `root` running? */
export async function gatewayStatus(root: string): Promise<{ running: boolean; pid: number | null }> {
  const pid = await gatewayPid(root);
  return pid !== null && alive(pid) ? { running: true, pid } : { running: false, pid: null };
}

/** <root>/gateway.pid is JSON {pid, kind: "hermes-gateway", hermes_home, ...} (gateway/status.py). */
export async function gatewayPid(root: string): Promise<number | null> {
  try {
    const rec = JSON.parse(await readFile(join(root, "gateway.pid"), "utf8")) as { pid?: unknown; kind?: unknown };
    return typeof rec.pid === "number" && rec.kind === "hermes-gateway" ? rec.pid : null;
  } catch {
    return null;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function runQuiet(bin: HermesBinary, argv: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const cmd = hermesCommand(bin, argv, env);
    const child = spawn(cmd.file, cmd.args, { env: cmd.env, stdio: "ignore", shell: bin.shell, windowsHide: true });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

/**
 * `hermes chat` auto-starts one multiplex gateway per Hermes root, and that
 * gateway discovers MCP servers once, at boot. After a compile changes a
 * config.yaml the engine stops it (`hermes gateway stop`) and waits for the
 * process to really exit — a run started while the old one is still tearing
 * down fails with "Gateway starting: deadline". The next run starts a fresh one.
 */
export async function stopGateway(bin: HermesBinary, root: string, timeoutMs = 90_000): Promise<"stopped" | "not-running" | "timeout"> {
  const pid = await gatewayPid(root);
  if (pid === null || !alive(pid)) return "not-running";
  await runQuiet(await prepareHermes(bin, root), ["gateway", "stop"], hermesEnv(root), timeoutMs);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!alive(pid)) return "stopped";
    await new Promise((r) => setTimeout(r, 250));
  }
  return "timeout";
}
