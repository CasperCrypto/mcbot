/**
 * Everything the engine knows about invoking Hermes. Every flag here was
 * checked against `hermes --help` and the Hermes source (docs/HERMES.md).
 */
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { delimiter, join } from "node:path";

export interface HermesBinary {
  path: string;
  /** .cmd/.bat shims need a shell on Windows. */
  shell: boolean;
}

async function executable(p: string): Promise<boolean> {
  try {
    await access(p, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** MCBOT_HERMES_BIN, else the first `hermes` on PATH (PATHEXT-aware on Windows). */
export async function findHermes(env: NodeJS.ProcessEnv = process.env): Promise<HermesBinary | null> {
  const explicit = env.MCBOT_HERMES_BIN?.trim();
  const isShim = (p: string) => /\.(cmd|bat)$/i.test(p);
  if (explicit) return (await executable(explicit)) ? { path: explicit, shell: isShim(explicit) } : null;
  const exts = process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").map((e) => e.toLowerCase()) : [""];
  for (const dir of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = join(dir, `hermes${ext}`);
      if (await executable(candidate)) return { path: candidate, shell: isShim(candidate) };
    }
  }
  return null;
}

/**
 * argv for one headless turn: `hermes -p <profile> chat --query-file - --oneshot --format stream-json`.
 * The prompt goes on stdin (--query-file -) so nothing is shell-interpreted. No --source:
 * the gateway only accepts sources from its own contract (`mcbot` is refused), and a
 * one-shot run defaults to `oneshot`.
 */
export function chatArgv(profile: string): string[] {
  return ["-p", profile, "chat", "--query-file", "-", "--oneshot", "--format", "stream-json"];
}

export function hermesEnv(root: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...base, HERMES_HOME: root };
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
    const child = spawn(bin.path, argv, { env, stdio: "ignore", shell: bin.shell, windowsHide: true });
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
  await runQuiet(bin, ["gateway", "stop"], hermesEnv(root), timeoutMs);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!alive(pid)) return "stopped";
    await new Promise((r) => setTimeout(r, 250));
  }
  return "timeout";
}
