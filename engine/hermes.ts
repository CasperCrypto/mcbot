/**
 * Everything the engine knows about invoking Hermes. Every flag here was
 * checked against `hermes --help` and the Hermes source (docs/HERMES.md).
 */
import { execFile, spawn } from "node:child_process";
import { constants, existsSync, readdirSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface HermesBinary {
  path: string;
  /** .cmd/.bat shims need a shell on Windows. */
  shell: boolean;
  /** Arguments before Hermes' own (McBot's copy: the `hermes` launcher script for its Python). */
  prefix?: string[];
  /** Extra environment for every Hermes process. */
  env?: Record<string, string>;
  /** "bundled": McBot's own copy in hermes/ (our fork); "external": an install found elsewhere. */
  kind: "bundled" | "external";
}

/** hermes/ next to engine/ (from source); the installed app passes MCBOT_HERMES_DIR. */
export const BUNDLED_HERMES_DIR = (() => {
  try {
    return resolve(fileURLToPath(new URL("../hermes", import.meta.url)));
  } catch {
    return resolve(process.cwd(), "hermes"); // a bundle without import.meta (the packaged engine)
  }
})();

/** Where McBot's Hermes lives and keeps its tools (Python, uv, Node…). */
export function bundledSource(env: NodeJS.ProcessEnv = process.env): { dir: string; runtime: string } | null {
  const dir = env.MCBOT_HERMES_DIR?.trim() || BUNDLED_HERMES_DIR;
  if (!existsSync(join(dir, "hermes")) || !existsSync(join(dir, "pm"))) return null;
  return { dir, runtime: env.HERMES_RUNTIME_DIR?.trim() || join(dir, ".hermes-runtime") };
}

/** The pinned Python Hermes' package manager put in the tool store (scripts/_activation.sh `hermes_bootstrap_python`). */
function storePython(store: string): string | null {
  try {
    for (const d of readdirSync(store).filter((n) => n.startsWith("python-")).sort().reverse()) {
      for (const rel of ["bin/python3", "python.exe", "bin/python", "bin/python.exe"]) {
        const p = join(store, d, rel);
        if (existsSync(p)) return p;
      }
    }
  } catch {
    /* no store yet */
  }
  return null;
}

/**
 * McBot's own Hermes, once its tools exist (first launch, or `npm run engine:setup`): its Python
 * running the `hermes` launcher. Use it through prepareHermes(), which adds Hermes' environment.
 * Runs do NOT set HERMES_MANAGED: a managed install stops creating its home's folders and securing
 * them (hermes_cli/config_home.py `initialize_home`). Only the terminal launcher sets it.
 */
export function bundledHermes(env: NodeJS.ProcessEnv = process.env): HermesBinary | null {
  const src = bundledSource(env);
  return src && bundledFrom(src);
}

function bundledFrom(src: { dir: string; runtime: string }): HermesBinary | null {
  const py = storePython(src.runtime);
  return py ? { path: py, shell: false, kind: "bundled", prefix: [join(src.dir, "hermes")], env: { HERMES_RUNTIME_DIR: src.runtime } } : null;
}

/**
 * Hermes' environment for `home`, from its package manager (`python -m pm.environments --format json`,
 * hermes/pm/environments.py): PYTHONPATH with the installed dependencies, PATH with its tools, the
 * activation marker. Dependencies are installed per Hermes home (`<home>/installs/`); null when this
 * home has none yet.
 */
function composeEnv(bin: HermesBinary, dir: string, home: string): Promise<Record<string, string> | null> {
  const base: NodeJS.ProcessEnv = { ...process.env, ...bin.env, HERMES_HOME: home, PYTHONHOME: "", PYTHONPATH: dir };
  return new Promise((resolve) => {
    execFile(bin.path, ["-m", "pm.environments", "--format", "json"], { cwd: dir, env: base, maxBuffer: 16 << 20, timeout: 120_000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        const all = JSON.parse(stdout) as Record<string, string>;
        if (!/site-packages/.test(all.PYTHONPATH ?? "")) return resolve(null);
        const added: Record<string, string> = {};
        for (const [k, v] of Object.entries(all)) if (k !== "HERMES_HOME" && k !== "_" && process.env[k] !== v) added[k] = String(v);
        resolve(added);
      } catch {
        resolve(null);
      }
    });
  });
}

/** Hermes' own setup (`setup-hermes.sh --runtime-only`, `setup-hermes.ps1 -RuntimeOnly` on Windows): tools into the store, dependencies for `home`. */
export function runHermesSetup(src: { dir: string; runtime: string }, home: string, onLine: (line: string) => void = () => undefined): Promise<boolean> {
  const win = process.platform === "win32";
  const [file, args] = win
    ? ["powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(src.dir, "setup-hermes.ps1"), "-RuntimeOnly"]]
    : ["bash", [join(src.dir, "setup-hermes.sh"), "--runtime-only"]];
  const env: NodeJS.ProcessEnv = { ...process.env, HERMES_RUNTIME_DIR: src.runtime, HERMES_HOME: home, PYTHONHOME: "", PYTHONPATH: "", VIRTUAL_ENV: "" };
  return new Promise((resolve) => {
    const child = spawn(file, args as string[], { cwd: src.dir, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const feed = (chunk: Buffer) => {
      tail += chunk.toString("utf8");
      const lines = tail.split(/\r?\n|\r/);
      tail = lines.pop() ?? "";
      for (const l of lines) {
        // eslint-disable-next-line no-control-regex
        const clean = l.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim();
        if (clean) onLine(clean);
      }
    };
    child.stdout!.on("data", feed);
    child.stderr!.on("data", feed);
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

/**
 * One preparation per Hermes home at a time. A run that starts while the home is being prepared
 * (the setup assistant's Prepare, or another run) waits for that preparation instead of starting
 * a second Hermes setup on the same home, which would only queue behind its install lock.
 */
const prepared = new Map<string, Promise<Record<string, string> | null>>();
const preparing = new Set<string>();
const homeKey = (src: { dir: string }, home: string) => `${src.dir}\0${home}`;

function once(key: string, make: () => Promise<Record<string, string> | null>): Promise<Record<string, string> | null> {
  let ready = prepared.get(key);
  if (!ready) {
    preparing.add(key);
    ready = make().catch(() => null).finally(() => preparing.delete(key));
    prepared.set(key, ready);
    void ready.then((r) => { if (!r) prepared.delete(key); }); // try again next time
  }
  return ready;
}

const sourceOf = (bin: HermesBinary) => {
  // bundledHermes(): prefix[0] is <dir>/hermes, the store is HERMES_RUNTIME_DIR.
  const dir = dirname(bin.prefix![0]!);
  return { dir, runtime: bin.env?.HERMES_RUNTIME_DIR ?? join(dir, ".hermes-runtime") };
};

/**
 * McBot's own Hermes, ready to launch for `home`: its environment composed once per home and
 * reused (a launch then starts in about 0.2 s). A home without Hermes' dependencies gets them first
 * (Hermes' setup, minutes on first use; progress goes to `onLine`). An external Hermes is used as is.
 */
export async function prepareHermes(bin: HermesBinary, home: string, onLine?: (line: string) => void): Promise<HermesBinary> {
  if (bin.kind !== "bundled" || !bin.prefix?.[0]) return bin;
  const src = sourceOf(bin);
  const key = homeKey(src, home);
  if (preparing.has(key)) onLine?.("Waiting for the engine to finish preparing…");
  const env = await once(key, async () => {
    const env = await composeEnv(bin, src.dir, home);
    if (env) return env;
    onLine?.("Preparing Hermes for this home (first use)…");
    if (!(await runHermesSetup(src, home, onLine))) return null;
    return composeEnv(bin, src.dir, home);
  });
  return env ? { ...bin, env: { ...bin.env, ...env } } : bin;
}

/**
 * First launch (POST /api/hermes/prepare): Hermes' setup for `home`, which also fills the tool
 * store, then its environment. It always runs Hermes' setup, unless a preparation of this home is
 * already under way, which it joins. Null when it failed.
 */
export async function setupHome(src: { dir: string; runtime: string }, home: string, onLine: (line: string) => void): Promise<HermesBinary | null> {
  const key = homeKey(src, home);
  if (!preparing.has(key)) prepared.delete(key);
  const env = await once(key, async () => {
    if (!(await runHermesSetup(src, home, onLine))) return null;
    const bin = bundledFrom(src);
    return bin && composeEnv(bin, src.dir, home);
  });
  const bin = bundledFrom(src);
  return env && bin ? { ...bin, env: { ...bin.env, ...env } } : null;
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
 * Start the root's gateway if it is not running and keep it up: `hermes gateway ensure`, what
 * Hermes' own desktop app runs (no idle exit, nothing installed; hermes_cli/gateway_runtime_start.py).
 * Chat apps need a running gateway even when no run is in progress. Exit 0 = ready.
 */
export async function ensureGateway(bin: HermesBinary, root: string, timeoutMs = 90_000): Promise<number | null> {
  return runQuiet(await prepareHermes(bin, root), ["gateway", "ensure", "--json", "--timeout", String(Math.round(timeoutMs / 1000) - 10)], hermesEnv(root), timeoutMs);
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
