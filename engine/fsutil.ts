import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** Write via temp file + rename so readers (Hermes included) never see a torn file. */
export async function atomicWrite(path: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.mcbot-${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(tmp, content);
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

export async function readTextOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Resolve a relative POSIX path under root, refusing anything that escapes it. */
export function resolveInside(root: string, relPath: string): string {
  if (isAbsolute(relPath) || relPath.split(/[\\/]/).includes("..")) throw new Error(`path escapes root: ${relPath}`);
  const abs = resolve(root, ...relPath.split("/"));
  const rel = relative(resolve(root), abs);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`path escapes root: ${relPath}`);
  return abs;
}

export function toPosix(p: string): string {
  return p.split(sep).join("/");
}
