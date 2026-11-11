/**
 * `npm run engine` — start the local McBot engine.
 *
 *   MCBOT_WORKSPACE   where boards/, runs/ and hermes/ live   (default ~/McBot)
 *   MCBOT_HERMES_HOME compile output root = HERMES_HOME for runs (default <workspace>/hermes)
 *   MCBOT_HERMES_BIN  a Hermes to use instead of McBot's own    (default: hermes/, else `hermes` on PATH)
 *   MCBOT_HERMES_DIR  McBot's own Hermes (the installed app passes its copy; default: hermes/ in the repo)
 *   HERMES_RUNTIME_DIR where that Hermes keeps its tools       (default: <MCBOT_HERMES_DIR>/.hermes-runtime)
 *   MCBOT_PORT        loopback port                            (default 4317)
 *   MCBOT_ALLOWED_ORIGINS  extra comma-separated browser origins
 *   MCBOT_HERMES_BUNDLE + MCBOT_DATA_DIR   the installed app: its read-only copy of Hermes and a
 *                     writable folder; Hermes is copied there on first launch (engine/bundle.ts)
 */
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { installBundledHermes } from "./bundle";
import { DEFAULT_ORIGINS, startEngine } from "./server";

// node:sqlite is stable enough for read-only SELECTs; keep its notice out of the log.
process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.name !== "ExperimentalWarning") console.warn(w);
});

/** No top-level await: the packaged engine is a CommonJS bundle (scripts/build-engine.mjs). */
async function main(): Promise<void> {
  const bundle = process.env.MCBOT_HERMES_BUNDLE?.trim();
  const dataDir = process.env.MCBOT_DATA_DIR?.trim();
  if (bundle && dataDir && !process.env.MCBOT_HERMES_DIR) {
    await mkdir(dataDir, { recursive: true });
    process.env.MCBOT_HERMES_DIR = installBundledHermes(bundle, dataDir);
    process.env.HERMES_RUNTIME_DIR ??= join(dataDir, "hermes-runtime");
  }
  const workspace = resolve(process.env.MCBOT_WORKSPACE ?? join(homedir(), "McBot"));
  const hermesHome = resolve(process.env.MCBOT_HERMES_HOME ?? join(workspace, "hermes"));
  await mkdir(join(workspace, "boards"), { recursive: true });
  // The shared folder the "Files tool" preset hands to the MCP filesystem server.
  await mkdir(join(workspace, "files"), { recursive: true });
  await mkdir(hermesHome, { recursive: true });

  const port = Number(process.env.MCBOT_PORT ?? 4317);
  const engine = await startEngine({
    workspace,
    hermesHome,
    managedRoot: !process.env.MCBOT_HERMES_HOME,
    port,
    host: "127.0.0.1",
    allowedOrigins: [...DEFAULT_ORIGINS, ...(process.env.MCBOT_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)],
    logFile: dataDir ? join(dataDir, "engine.log") : undefined,
  });

  if ((await engine.relay.list()).length === 0) await engine.relay.create("main", "My first harness");

  console.log(`McBot engine ${engine.url}`);
  console.log(`  workspace   ${workspace}`);
  console.log(`  hermes home ${hermesHome}${process.env.MCBOT_HERMES_HOME ? " (external: gateway left alone)" : ""}`);
  if (process.env.MCBOT_HERMES_DIR) console.log(`  hermes      ${process.env.MCBOT_HERMES_DIR}`);

  let closing = false;
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, async () => {
      if (closing) return;
      closing = true;
      await engine.close();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  console.error("McBot engine failed to start:", err);
  process.exit(1);
});
