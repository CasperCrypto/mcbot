/**
 * The installed app ships Hermes read-only inside its resources (an app bundle, Program Files),
 * but Hermes writes next to its code. On first launch, and after an update changes it, the engine
 * copies it into McBot's data folder and runs it from there. Tools live beside it, shared by every
 * version: <data>/hermes-runtime.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Which Hermes this is: the upstream commit and McBot's changes to it. */
export function bundleStamp(bundle: string): string {
  const h = createHash("sha256");
  for (const f of ["UPSTREAM.json", "MCBOT.md"]) {
    try {
      h.update(readFileSync(join(bundle, f)));
    } catch {
      h.update(`no ${f}`);
    }
  }
  return h.digest("hex").slice(0, 12);
}

/** The writable copy of the shipped Hermes for this version, made if missing. Returns its folder. */
export function installBundledHermes(bundle: string, dataDir: string): string {
  const target = join(dataDir, `hermes-${bundleStamp(bundle)}`);
  if (existsSync(join(target, ".mcbot-installed"))) return target;
  const tmp = `${target}.partial`;
  rmSync(tmp, { recursive: true, force: true });
  cpSync(bundle, tmp, { recursive: true });
  writeFileSync(join(tmp, ".mcbot-installed"), `${new Date().toISOString()}\n`);
  rmSync(target, { recursive: true, force: true });
  renameSync(tmp, target);
  return target;
}
