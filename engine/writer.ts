/**
 * Writes a CompileResult under an output root (a Hermes home) and reports a
 * per-file diff. The only module that writes compiled files to disk.
 *
 * Ownership rule: McBot owns exactly the files its previous manifest lists.
 * It never deletes anything else, and it refuses to write into a profile
 * directory it did not create — so pointing the output root at a real
 * ~/.hermes cannot clobber a hand-made profile.
 */
import { createTwoFilesPatch } from "diff";
import { mkdir, readdir, rm } from "node:fs/promises";
import {
  MANIFEST_PATH,
  type CompileReport,
  type CompileResult,
  type FileChange,
  type Manifest,
} from "../src/contracts/compile";
import { sha256Hex, utf8Bytes } from "../src/compile/text";
import { mergeConfig } from "../src/harness/merge";
import { atomicWrite, readTextOrNull, resolveInside } from "./fsutil";

export class OwnershipError extends Error {
  constructor(readonly profile: string, readonly dir: string) {
    super(`profiles/${profile} already exists at ${dir} and was not created by McBot; refusing to overwrite it`);
    this.name = "OwnershipError";
  }
}

export async function readManifest(root: string): Promise<Manifest | null> {
  const raw = await readTextOrNull(resolveInside(root, MANIFEST_PATH));
  if (raw === null) return null;
  const parsed = JSON.parse(raw) as Manifest;
  return Array.isArray(parsed.files) && Array.isArray(parsed.profiles) ? parsed : null;
}

async function isEmptyOrMissing(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).length === 0;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw err;
  }
}

function unifiedDiff(path: string, before: string, after: string): string {
  if (before === after) return "";
  return createTwoFilesPatch(`a/${path}`, `b/${path}`, before, after, "", "", { context: 3 });
}

export interface WriteOptions {
  /** Compute the report without touching the disk. */
  dryRun?: boolean;
}

export async function writeCompileResult(result: CompileResult, root: string, opts: WriteOptions = {}): Promise<CompileReport> {
  const previous = await readManifest(root);
  const owned = new Set(previous?.profiles ?? []);

  for (const p of result.profiles) {
    const dir = resolveInside(root, p.dir);
    if (!owned.has(p.name) && !(await isEmptyOrMissing(dir))) throw new OwnershipError(p.name, dir);
  }

  const changes: FileChange[] = [];
  const next = new Set(result.files.map((f) => f.path));

  // config.yaml is merged into the one on disk: McBot changes only the keys the board shows and
  // keeps everything Hermes, the CLI or an agent added (src/harness/merge.ts).
  const files = result.files.map((f) => ({ ...f }));
  for (const f of files) {
    const before = await readTextOrNull(resolveInside(root, f.path));
    if (f.role === "config") {
      const merged = mergeConfig(before, f.content);
      if (merged !== f.content) Object.assign(f, { content: merged, sha256: sha256Hex(merged), bytes: utf8Bytes(merged).length });
    }
    const prevSha = before === null ? null : sha256Hex(before);
    changes.push({
      path: f.path,
      status: before === null ? "added" : prevSha === f.sha256 ? "unchanged" : "modified",
      sha256: f.sha256,
      previousSha256: prevSha,
      bytes: f.bytes,
      role: f.role,
      nodeId: f.nodeId ?? null,
      diff: unifiedDiff(f.path, before ?? "", f.content),
    });
  }

  for (const old of previous?.files ?? []) {
    if (next.has(old.path)) continue;
    const before = await readTextOrNull(resolveInside(root, old.path));
    if (before === null) continue;
    changes.push({
      path: old.path,
      status: "removed",
      sha256: null,
      previousSha256: sha256Hex(before),
      bytes: utf8Bytes(before).length,
      role: null,
      nodeId: null,
      diff: unifiedDiff(old.path, before, ""),
    });
  }
  changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  if (!opts.dryRun) {
    for (const d of result.dirs) await mkdir(resolveInside(root, d), { recursive: true });
    for (const c of changes) if (c.status === "removed") await rm(resolveInside(root, c.path), { force: true });
    // Manifest last: if anything above fails, the old manifest still describes the disk.
    const ordered = [...files].sort((a, b) => Number(a.path === MANIFEST_PATH) - Number(b.path === MANIFEST_PATH));
    for (const f of ordered) {
      const change = changes.find((c) => c.path === f.path);
      if (change?.status !== "unchanged") await atomicWrite(resolveInside(root, f.path), f.content);
    }
  }

  return { graphId: result.graphId, root, written: !opts.dryRun, profiles: result.profiles, changes };
}
