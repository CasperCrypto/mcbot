/**
 * Read-only folder browsing for the Files graph. The engine only lists or reads
 * inside a "root": a folder the user explicitly opened, the shared workspace
 * files folder, or an agent's compiled profile. Opened folders persist in
 * <workspace>/folders.json.
 *
 * The code editor writes back (`write`) to an opened folder, the shared files folder, and in an
 * agent's folder its Hermes settings and `workspace/` (`agentEditable`; the board follows the
 * settings). Never memory, logs, state or a key file, and only over the exact bytes the editor
 * read (sha256), so an agent's change is never lost.
 */
import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { sha256Hex } from "../src/compile/text";
import { agentEditable } from "../src/harness/live";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { FsBrowse, FsEntry, FsRoot } from "../src/contracts/api";
import { atomicWrite, readTextOrNull, resolveInside, toPosix } from "./fsutil";
import { SECRET_FILES } from "./profileEnv";

const MAX_ENTRIES = 400;
const MAX_PREVIEW = 512_000;

export class FolderError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function inside(root: string, rel: string): string {
  try {
    return resolveInside(root, rel);
  } catch {
    throw new FolderError(400, "path is outside the folder");
  }
}

export { agentEditable };

/** "~/code" → "/Users/you/code"; anything else as typed. */
export function expandHome(path: string, home = homedir()): string {
  const p = path.trim();
  return p === "~" ? home : /^~[\\/]/.test(p) ? join(home, p.slice(2)) : p;
}

/** Folders people usually open, those that exist here. */
const PLACES = ["Desktop", "Documents", "Downloads", "Projects", "Developer", "code", "src", "Code", "dev"];

/**
 * The folder picker (host only, never a network member): the subfolders of one folder, so a
 * person can open a folder without typing its path. Names only, never a file or its contents.
 */
export async function browseFolders(path: string | null, home = homedir()): Promise<FsBrowse> {
  const abs = resolve(path ? expandHome(path, home) : home);
  if (!isAbsolute(abs)) throw new FolderError(400, "use an absolute path");
  const items = await readdir(abs, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
    throw new FolderError(err.code === "ENOENT" ? 404 : 403, err.code === "ENOENT" ? `${abs} doesn't exist` : `McBot can't read ${abs}`);
  });
  const dirs = items
    .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules")
    .map((d) => ({ name: d.name, path: join(abs, d.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    .slice(0, MAX_ENTRIES);
  const places = [{ name: "Home", path: home }];
  for (const name of PLACES) {
    const p = join(home, name);
    if ((await stat(p).catch(() => null))?.isDirectory()) places.push({ name, path: p });
  }
  const parent = dirname(abs);
  return { path: abs, parent: parent === abs ? null : parent, dirs, places };
}

export class Folders {
  constructor(private readonly workspace: string, private readonly hermesHome: string) {}

  private get file() {
    return join(this.workspace, "folders.json");
  }

  async opened(): Promise<FsRoot[]> {
    const raw = await readTextOrNull(this.file);
    if (!raw) return [];
    try {
      const list = JSON.parse(raw) as FsRoot[];
      return Array.isArray(list) ? list.filter((r) => r && typeof r.path === "string" && typeof r.id === "string") : [];
    } catch {
      return [];
    }
  }

  async open(path: string): Promise<FsRoot> {
    const typed = expandHome(path);
    if (!isAbsolute(typed)) throw new FolderError(400, "Use a full path, like ~/Documents or /Users/you/project");
    const abs = resolve(typed);
    const s = await stat(abs).catch(() => null);
    if (!s?.isDirectory()) throw new FolderError(404, `${abs} is not a folder`);
    const list = await this.opened();
    const existing = list.find((r) => r.path === abs);
    if (existing) return existing;
    const root: FsRoot = { id: `folder:${createHash("sha1").update(abs).digest("hex").slice(0, 10)}`, kind: "folder", name: basename(abs) || abs, path: abs };
    await atomicWrite(this.file, `${JSON.stringify([...list, root], null, 2)}\n`);
    return root;
  }

  async close(id: string): Promise<void> {
    const list = await this.opened();
    await atomicWrite(this.file, `${JSON.stringify(list.filter((r) => r.id !== id), null, 2)}\n`);
  }

  /** The absolute directory a root id stands for, or a 404. */
  async resolveRoot(id: string, compiledProfiles: readonly string[]): Promise<string> {
    if (id === "workspace:files") return join(this.workspace, "files");
    if (id.startsWith("profile:")) {
      const name = id.slice("profile:".length);
      if (!compiledProfiles.includes(name)) throw new FolderError(404, `${name} is not compiled yet`);
      return resolveInside(this.hermesHome, `profiles/${name}`);
    }
    const found = (await this.opened()).find((r) => r.id === id);
    if (!found) throw new FolderError(404, "that folder is not open");
    return found.path;
  }

  async list(rootDir: string, rel: string, owned: (relToRoot: string) => boolean = () => false): Promise<{ entries: FsEntry[]; truncated: number }> {
    const dir = rel ? inside(rootDir, rel) : rootDir;
    const items = await readdir(dir, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
      throw new FolderError(err.code === "ENOENT" ? 404 : 403, `cannot read ${rel || "folder"}: ${err.code}`);
    });
    const sorted = items
      .filter((d) => (d.isDirectory() || d.isFile()) && !(d.isFile() && SECRET_FILES.has(d.name)))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    const entries: FsEntry[] = [];
    for (const d of sorted.slice(0, MAX_ENTRIES)) {
      const path = toPosix(rel ? `${rel}/${d.name}` : d.name);
      const abs = join(dir, d.name);
      if (d.isDirectory()) {
        const children = await readdir(abs).then((c) => c.length).catch(() => null);
        entries.push({ name: d.name, path, kind: "dir", bytes: 0, children, owned: false });
      } else {
        const s = await stat(abs).catch(() => null);
        entries.push({ name: d.name, path, kind: "file", bytes: s?.size ?? 0, children: null, owned: owned(path) });
      }
    }
    return { entries, truncated: Math.max(0, sorted.length - MAX_ENTRIES) };
  }

  async read(rootDir: string, rel: string): Promise<{ path: string; bytes: number; text: string | null; reason?: string; sha256?: string }> {
    const abs = inside(rootDir, rel);
    // Keys live in .env files (engine/profileEnv.ts): never shown, whatever the folder.
    if (SECRET_FILES.has(basename(abs))) throw new FolderError(403, "This file holds keys and is not shown");
    const s = await stat(abs).catch(() => null);
    if (!s?.isFile()) throw new FolderError(404, "no such file");
    if (s.size > MAX_PREVIEW) return { path: rel, bytes: s.size, text: null, reason: "Too large to preview" };
    const text = (await readTextOrNull(abs)) ?? "";
    return text.includes("\u0000") ? { path: rel, bytes: s.size, text: null, reason: "Binary file" } : { path: rel, bytes: s.size, text, sha256: sha256Hex(text) };
  }

  /**
   * Save a text file the editor opened. `rootId` decides what may be written (see the header);
   * `baseSha256` is what the editor read (null = a new file that must not exist yet).
   */
  async write(rootId: string, rootDir: string, rel: string, text: string, baseSha256: string | null): Promise<{ path: string; bytes: number; sha256: string }> {
    const posix = rel.replace(/\\/g, "/");
    if (rootId.startsWith("profile:") && !agentEditable(posix)) throw new FolderError(403, "Only an agent's settings (SOUL.md, config.yaml, profile.yaml, skills) and its workspace folder are edited here");
    const abs = inside(rootDir, posix);
    if (SECRET_FILES.has(basename(abs))) throw new FolderError(403, "This file holds keys and is not edited here");
    const current = await readTextOrNull(abs);
    const now = current === null ? null : sha256Hex(current);
    if (now !== baseSha256) throw new FolderError(409, current === null ? "The file was deleted since you opened it" : "The file changed since you opened it. Reopen it to see the change.");
    await atomicWrite(abs, text);
    return { path: posix, bytes: Buffer.byteLength(text), sha256: sha256Hex(text) };
  }
}
