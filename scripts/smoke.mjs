/**
 * Smoke test of the installed app's path, without its window: the engine as the one
 * executable the app ships, Hermes staged as the installer bundles it, the first-launch
 * preparation, then a real agent run (a memory tool call) against the stub model.
 *
 *   node scripts/build-engine.mjs && node scripts/stage-hermes.mjs && node scripts/smoke.mjs
 *
 * CI runs it on macOS, Windows and Linux (.github/workflows/smoke.yml). Exits non-zero, with
 * the engine log and McBot's own problem report, when any step fails.
 */
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE_PORT = 4391;
const STUB_PORT = 11581;
const api = `http://127.0.0.1:${ENGINE_PORT}`;
const started = Date.now();
const since = (t) => `${Math.round((Date.now() - t) / 1000)} s`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const children = [];

function step(text) {
  console.log(`\n▸ ${text} (${since(started)})`);
}

async function call(method, path, body) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${data.error ?? ""}`);
  return data;
}

async function until(what, ms, check, every = 1000) {
  const end = Date.now() + ms;
  for (;;) {
    // Not answering yet is normal while something starts; a fatal error stops the wait at once.
    const value = await check().catch((err) => {
      if (err.fatal) throw err;
      return null;
    });
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out after ${Math.round(ms / 1000)} s: ${what}`);
    await sleep(every);
  }
}

// The engine executable for this machine, as build-engine.mjs wrote it.
const binDir = join(root, "src-tauri", "binaries");
const bins = existsSync(binDir) ? readdirSync(binDir).filter((f) => f.startsWith("mcbot-engine-")) : [];
if (bins.length !== 1) throw new Error(`expected one engine in ${binDir}, found ${bins.length}: run node scripts/build-engine.mjs first`);
const engineBin = join(binDir, bins[0]);
const bundle = join(root, "dist-hermes", "hermes");
if (!existsSync(join(bundle, "UPSTREAM.json"))) throw new Error(`no staged Hermes in ${bundle}: run node scripts/stage-hermes.mjs first`);

const tmp = mkdtempSync(join(tmpdir(), "mcbot-smoke-"));
const data = join(tmp, "data");
const logFile = join(data, "engine.log");

async function main() {
  step(`stub model on :${STUB_PORT}`);
  const stub = spawn(process.execPath, [join(root, "node_modules", "tsx", "dist", "cli.mjs"), join(root, "test", "stub-llm", "main.ts")], {
    env: { ...process.env, STUB_LLM_PORT: String(STUB_PORT) },
    stdio: "inherit",
  });
  children.push(stub);

  step(`engine ${bins[0]}`);
  mkdirSync(data, { recursive: true });
  const log = createWriteStream(logFile);
  // As the app shell starts it (src-tauri/src/lib.rs): the bundled Hermes, a data folder, output to engine.log.
  const engine = spawn(engineBin, [], {
    env: { ...process.env, MCBOT_HERMES_BUNDLE: bundle, MCBOT_DATA_DIR: data, MCBOT_WORKSPACE: join(tmp, "McBot"), MCBOT_PORT: String(ENGINE_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(engine);
  engine.stdout.pipe(log);
  engine.stderr.pipe(log);
  engine.on("exit", (code) => console.log(`engine exited (${code})`));
  const health = await until("the engine answers", 60_000, () => call("GET", "/api/health"));
  console.log(`engine ${health.version} up, workspace ${health.workspace}`);

  step("first launch: preparing the engine");
  const t0 = Date.now();
  await call("POST", "/api/hermes/prepare", {});
  let shown = 0;
  const info = await until("the engine is prepared", 40 * 60_000, async () => {
    const h = await call("GET", "/api/hermes");
    for (const line of h.setup.lines.slice(shown)) console.log(`  ${line}`);
    shown = Math.max(shown, h.setup.lines.length);
    if (h.setup.state === "failed") throw Object.assign(new Error("preparing the engine failed"), { fatal: true });
    return h.kind === "bundled" ? h : null;
  }, 3000);
  console.log(`prepared in ${since(t0)}: ${info.path}`);

  step("a board with one agent on the stub model");
  const graph = {
    schema: "mcbot.graph/v1", id: "smoke", name: "Smoke",
    nodes: [
      { id: "n-agent", kind: "agent", position: { x: 0, y: 0 }, data: { name: "triage", displayName: "Triage", description: "Routes tickets.", soul: "", skills: [], capabilities: null } },
      { id: "n-model", kind: "model", position: { x: -300, y: 0 }, data: { name: "local", label: "Local", endpoint: "local", baseUrl: `http://127.0.0.1:${STUB_PORT}/v1`, model: "stub-model", apiKeyEnv: "", pricing: null } },
    ],
    edges: [{ id: "e1", source: "n-agent", target: "n-model", order: 0 }],
  };
  const board = await call("POST", "/api/setup/board", { name: "Smoke", graph });
  const compiled = await call("POST", "/api/compile", { boardId: board.id });
  if (!compiled.ok) throw new Error(`compile: ${compiled.error} ${JSON.stringify(compiled.issues)}`);
  console.log(`compiled ${compiled.report.changes.length} files into ${compiled.report.root}`);

  step("a real run: the agent saves a memory");
  const t1 = Date.now();
  const { runId } = await call("POST", "/api/runs", { boardId: board.id, agentNodeId: "n-agent", prompt: "remember: Smoke tests pass" });
  const events = await until("the run finishes", 10 * 60_000, async () => {
    const ev = await call("GET", `/api/runs/${runId}`);
    return ev.some((e) => e.type === "run.finished") ? ev : null;
  }, 1000);
  const finished = events.find((e) => e.type === "run.finished");
  const tool = events.find((e) => e.type === "run.tool.started");
  console.log(`run ${finished.status} in ${since(t1)}: ${JSON.stringify(finished.text)}${tool ? `, tool ${tool.tool}` : ""}`);
  if (finished.status !== "succeeded" || finished.text !== "Saved to memory: Smoke tests pass") {
    throw new Error(`run: ${JSON.stringify(events.filter((e) => e.type !== "run.log").slice(-6))}`);
  }

  step("Report a problem");
  console.log((await call("GET", "/api/diagnostics")).text);
  console.log(`✓ smoke test passed in ${since(started)}`);
}

let failed = false;
try {
  await main();
} catch (err) {
  failed = true;
  console.error(`\n✗ ${err.message}`);
  try {
    console.error(`\n--- McBot's problem report ---\n${(await call("GET", "/api/diagnostics")).text}`);
  } catch {
    console.error(`\n--- engine log ---\n${existsSync(logFile) ? readFileSync(logFile, "utf8").slice(-20_000) : "(none)"}`);
  }
} finally {
  for (const c of children) c.kill();
}
process.exit(failed ? 1 : 0);
