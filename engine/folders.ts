/**
 * The Files view's folders. The engine only lists, reads or changes inside a "root": a folder the
 * user explicitly opened, the shared workspace files folder, or an agent's compiled profile.
 * Opened folders persist in <workspace>/folders.json.
 *
 * The editor writes back (`write`) to an opened folder, the shared files folder, and in an agent's
 * folder its Hermes settings and `workspace/` (`agentEditable`; the board follows the settings).
 * Never memory, logs, state or a key file, and only over the exact bytes the editor read (sha256),
 * so an agent's change is never lost.
 *
 * Files are added (dropped or picked), folders made, renamed, moved and deleted only where
 * `changeable` says: anywhere in an opened folder or the shared files folder, and in an agent's
 * folder only inside `workspace/` (its settings are edited there, never moved or removed). A new
 * file never replaces one ("name (2).ext"). Deleting moves the item to <workspace>/.trash for 30
 * days, so Undo puts it back.
 */
import { createHash, randomBytes } from "node:crypto";
import { cp, mkdir, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { sha256Hex } from "../src/compile/text";
import { addable, agentEditable, changeable, normal, safeName } from "../src/harness/live";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FsBrowse, FsEntry, FsRoot } from "../src/contracts/api";
import { atomicWrite, readTextOrNull, resolveInside, toPosix } from "./fsutil";
import { freePath } from "./knowledge";
import { SECRET_FILES } from "./profileEnv";

const MAX_ENTRIES = 400;
const MAX_PREVIEW = 512_000;
/** The largest file a drop adds (the body is read whole). */
export const FILE_MAX_BYTES = 200 * 1_048_576;
/** How long a deleted file waits in the trash for Undo. */
const TRASH_DAYS = 30;
/** What a preview may stream as itself: images, video, sound. */
export const RAW_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".avif": "image/avif", ".ico": "image/x-icon", ".bmp": "image/bmp",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".m4v": "video/mp4",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".flac": "audio/flac",
};

const WHERE = "In an agent's folder, files are added, moved and deleted only inside workspace/";

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

export { addable, agentEditable, changeable, normal, safeName };

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
    if (now !== baseSha256) {
      throw new FolderError(409, baseSha256 === null ? `There is already a file called ${basename(abs)}` : current === null ? "The file was deleted since you opened it" : "The file changed since you opened it. Reopen it to see the change.");
    }
    await atomicWrite(abs, text);
    return { path: posix, bytes: Buffer.byteLength(text), sha256: sha256Hex(text) };
  }

  /** The absolute path of `rel` for a change: inside the root, never a key file. */
  private target(rootDir: string, rel: string): string {
    if (!normal(rel)) throw new FolderError(400, "That is the whole folder");
    const abs = inside(rootDir, normal(rel));
    if (SECRET_FILES.has(basename(abs))) throw new FolderError(403, "Files that hold keys are kept out of the Files view");
    return abs;
  }

  /** A folder to add into: it must exist. */
  private async folderAt(rootId: string, rootDir: string, dir: string): Promise<string> {
    const posix = normal(dir);
    if (!addable(rootId, posix)) throw new FolderError(403, WHERE);
    const abs = posix ? inside(rootDir, posix) : rootDir;
    if (!(await stat(abs).catch(() => null))?.isDirectory()) throw new FolderError(404, `${posix || "That folder"} is not there any more`);
    return abs;
  }

  /** A dropped or picked file, into folder `dir`; never over an existing file ("name (2).ext" instead). */
  async add(rootId: string, rootDir: string, dir: string, name: string, data: Uint8Array): Promise<{ path: string; bytes: number }> {
    const clean = safeName(name);
    if (!clean) throw new FolderError(400, "That file has no usable name");
    if (SECRET_FILES.has(clean)) throw new FolderError(403, "Files that hold keys are kept out of the Files view");
    const abs = freePath(await this.folderAt(rootId, rootDir, dir), clean);
    await writeFile(abs, data, { flag: "wx" });
    return { path: toPosix(relative(rootDir, abs)), bytes: data.length };
  }

  /** A new, empty folder called `name` in `dir`. */
  async mkdir(rootId: string, rootDir: string, dir: string, name: string): Promise<{ path: string }> {
    const clean = safeName(name);
    if (!clean || clean !== name.trim()) throw new FolderError(400, clean ? "Folder names can't have / \\ : * ? \" < > or |" : "Give the folder a name");
    const abs = join(await this.folderAt(rootId, rootDir, dir), clean);
    await mkdir(abs).catch((err: NodeJS.ErrnoException) => {
      throw new FolderError(err.code === "EEXIST" ? 409 : 403, err.code === "EEXIST" ? `There is already something called ${clean}` : `McBot can't make ${clean}: ${err.code}`);
    });
    return { path: toPosix(relative(rootDir, abs)) };
  }

  /** Rename or move `from` to `to` (both POSIX, in the same root); never over something that is there. */
  async rename(rootId: string, rootDir: string, from: string, to: string): Promise<{ path: string }> {
    const [a, b] = [normal(from), normal(to)] as const;
    if (!changeable(rootId, a) || !changeable(rootId, b)) throw new FolderError(403, WHERE);
    const name = safeName(basename(b));
    if (!name || name !== basename(b)) throw new FolderError(400, "Names can't have \\ : * ? \" < > or |");
    if (b === a) return { path: a };
    if (b.startsWith(`${a}/`)) throw new FolderError(400, "A folder can't go inside itself");
    const [src, dst] = [this.target(rootDir, a), this.target(rootDir, b)];
    const was = await stat(src).catch(() => null);
    if (!was) throw new FolderError(404, `${a} is not there any more`);
    // Taken, unless it is the same file (a rename that only changes letter case, on a disk that ignores case).
    const there = await stat(dst).catch(() => null);
    if (there && !(there.ino === was.ino && there.dev === was.dev)) throw new FolderError(409, `There is already something called ${basename(b)}`);
    if (!(await stat(dirname(dst)).catch(() => null))?.isDirectory()) throw new FolderError(404, `${dirname(b)} is not there`);
    await move(src, dst);
    return { path: b };
  }

  /** A file the preview streams as itself (an image, a video, a sound): inside the root, never a key file. */
  async raw(rootDir: string, rel: string): Promise<{ abs: string; type: string; size: number }> {
    const abs = this.target(rootDir, normal(rel));
    const type = RAW_TYPES[extname(abs).toLowerCase()];
    if (!type) throw new FolderError(415, "Only images, videos and sounds are shown as themselves");
    const [root, real] = await Promise.all([realpath(rootDir), realpath(abs)]).catch(() => {
      throw new FolderError(404, "no such file");
    });
    if (!real.startsWith(root + sep)) throw new FolderError(403, "That file is outside the folder");
    const s = await stat(real);
    if (!s.isFile()) throw new FolderError(404, "no such file");
    return { abs: real, type, size: s.size };
  }

  private get trash() {
    return join(this.workspace, ".trash");
  }

  /** Delete `path`: it waits in the trash for Undo (`restore`), then goes for good. */
  async remove(rootId: string, rootDir: string, path: string): Promise<{ trash: string; name: string }> {
    const posix = normal(path);
    if (!changeable(rootId, posix)) throw new FolderError(posix ? 403 : 400, posix ? WHERE : "That is the whole folder");
    const abs = this.target(rootDir, posix);
    if (!(await stat(abs).catch(() => null))) throw new FolderError(404, `${posix} is not there any more`);
    await this.prune();
    const id = `${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
    await mkdir(join(this.trash, id), { recursive: true });
    await move(abs, join(this.trash, id, basename(abs)));
    await atomicWrite(join(this.trash, `${id}.json`), `${JSON.stringify({ root: rootId, path: posix, at: Date.now() })}\n`);
    return { trash: id, name: basename(abs) };
  }

  /** Undo a delete: the item goes back where it was (beside it, as "name (2)", if that place is taken). */
  async restore(id: string, compiledProfiles: readonly string[]): Promise<{ root: string; path: string }> {
    if (!/^[a-z0-9]{8,24}$/.test(id)) throw new FolderError(400, "not a deleted item");
    const raw = await readTextOrNull(join(this.trash, `${id}.json`));
    if (!raw) throw new FolderError(404, "That is gone from the trash");
    const rec = JSON.parse(raw) as { root: string; path: string };
    const rootDir = await this.resolveRoot(rec.root, compiledProfiles);
    const want = this.target(rootDir, rec.path);
    await mkdir(dirname(want), { recursive: true });
    const back = freePath(dirname(want), basename(want));
    await move(join(this.trash, id, basename(want)), back);
    await rm(join(this.trash, id), { recursive: true, force: true });
    await rm(join(this.trash, `${id}.json`), { force: true });
    return { root: rec.root, path: toPosix(relative(rootDir, back)) };
  }

  /** What has waited in the trash longer than TRASH_DAYS goes for good. */
  private async prune(now = Date.now()): Promise<void> {
    const names = await readdir(this.trash).catch(() => [] as string[]);
    for (const n of names.filter((x) => extname(x) === ".json")) {
      const id = n.slice(0, -5);
      const at = Number((JSON.parse((await readTextOrNull(join(this.trash, n))) ?? "{}") as { at?: number }).at ?? 0);
      if (now - at > TRASH_DAYS * 86_400_000) {
        await rm(join(this.trash, id), { recursive: true, force: true });
        await rm(join(this.trash, n), { force: true });
      }
    }
  }
}

/** Move a file or folder, across disks too (an opened folder on another drive). */
async function move(src: string, dst: string): Promise<void> {
  try {
    await rename(src, dst);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw new FolderError(409, `McBot can't move ${basename(src)}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`);
    await cp(src, dst, { recursive: true, errorOnExist: true, force: false });
    await rm(src, { recursive: true, force: true });
  }
}
