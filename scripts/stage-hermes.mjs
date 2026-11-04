/**
 * The Hermes the installer ships: exactly the files git tracks in hermes/ (no caches, no
 * local runtime), copied to dist-hermes/hermes, which tauri.conf.json bundles as a resource.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, statSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "dist-hermes", "hermes");
rmSync(dest, { recursive: true, force: true });
const files = execFileSync("git", ["-C", root, "ls-files", "-z", "hermes"], { maxBuffer: 1 << 28 }).toString().split("\0").filter(Boolean);
for (const f of files) {
  const to = join(dest, f.slice("hermes/".length));
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(join(root, f), to);
  chmodSync(to, statSync(join(root, f)).mode & 0o777);
}
console.log(`hermes: ${files.length} files staged in ${dest}`);
