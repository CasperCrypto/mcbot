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

const MARK = ".mcbot-installed";
/** Windows refuses to delete or rename a folder while a process (a Hermes left running, an antivirus
 *  scan) holds a file in it: EBUSY, EPERM, EACCES, ENOTEMPTY. Such a folder is stepped around. */
const LOCKED = new Set(["EBUSY", "EPERM", "EACCES", "ENOTEMPTY"]);
const locked = (err: unknown) => LOCKED.has((err as NodeJS.ErrnoException)?.code ?? "");

/** The file operations the install needs (tests make one of them fail like Windows does). */
export interface BundleFs {
  rm(path: string): void;
  rename(from: string, to: string): void;
}
const realFs: BundleFs = {
  rm: (path) => rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }),
  rename: (from, to) => renameSync(from, to),
};

/**
 * The writable copy of the shipped Hermes for this version, made if missing. Returns its folder:
 * `hermes-<stamp>`, or `hermes-<stamp>-2` … when an unfinished copy at that place is locked and
 * can't be replaced (never fails the engine's start for a folder it can step around).
 */
export function installBundledHermes(bundle: string, dataDir: string, fs: BundleFs = realFs): string {
  const base = join(dataDir, `hermes-${bundleStamp(bundle)}`);
  const places = [base, ...[2, 3, 4, 5].map((n) => `${base}-${n}`)];
  const done = places.find((dir) => existsSync(join(dir, MARK)));
  if (done) return done;
  // A fresh copy beside them; an older unfinished one is removed if it can be, else left.
  const tmp = `${base}.partial-${process.pid}`;
  try { fs.rm(tmp); } catch { /* a locked leftover with our pid: copy over it */ }
  cpSync(bundle, tmp, { recursive: true, force: true });
  writeFileSync(join(tmp, MARK), `${new Date().toISOString()}\n`);
  for (const dir of places) {
    try {
      if (existsSync(dir)) fs.rm(dir);
      fs.rename(tmp, dir);
      return dir;
    } catch (err) {
      if (!locked(err)) throw err;
      console.warn(`[engine] ${dir} is in use (${(err as NodeJS.ErrnoException).code}); trying the next place`);
    }
  }
  // Every place is locked: run from the fresh copy where it is.
  return tmp;
}
