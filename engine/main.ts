/**
 * `npm run engine` — start the local McBot engine.
 *
 *   MCBOT_WORKSPACE   where boards/, runs/ and hermes/ live   (default ~/McBot)
 *   MCBOT_HERMES_HOME compile output root = HERMES_HOME for runs (default <workspace>/hermes)
 *   MCBOT_HERMES_BIN  hermes executable                        (default: `hermes` on PATH)
 *   MCBOT_PORT        loopback port                            (default 4317)
 *   MCBOT_ALLOWED_ORIGINS  extra comma-separated browser origins
 */
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_ORIGINS, startEngine } from "./server";

// node:sqlite is stable enough for read-only SELECTs; keep its notice out of the log.
process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.name !== "ExperimentalWarning") console.warn(w);
});

const workspace = resolve(process.env.MCBOT_WORKSPACE ?? join(homedir(), "McBot"));
const hermesHome = resolve(process.env.MCBOT_HERMES_HOME ?? join(workspace, "hermes"));
await mkdir(join(workspace, "boards"), { recursive: true });
await mkdir(hermesHome, { recursive: true });

const engine = await startEngine({
  workspace,
  hermesHome,
  managedRoot: !process.env.MCBOT_HERMES_HOME,
  port: Number(process.env.MCBOT_PORT ?? 4317),
  host: "127.0.0.1",
  allowedOrigins: [...DEFAULT_ORIGINS, ...(process.env.MCBOT_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)],
});

if ((await engine.relay.list()).length === 0) await engine.relay.create("main", "My first harness");

console.log(`McBot engine ${engine.url}`);
console.log(`  workspace   ${workspace}`);
console.log(`  hermes home ${hermesHome}${process.env.MCBOT_HERMES_HOME ? " (external: gateway left alone)" : ""}`);

let closing = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    if (closing) return;
    closing = true;
    await engine.close();
    process.exit(0);
  });
}
