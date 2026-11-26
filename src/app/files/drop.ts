/**
 * What a drop from Finder or Explorer holds: its files, and for a dropped folder everything in it
 * with the folders it sits in (an empty folder too). Read with the File and Directory Entries API,
 * which every webview McBot runs in has. Its entries must be taken while the drop event lasts, so
 * `takeDrop` reads them at once and walks them after. Caches and version-control folders stay
 * behind, and a drop stops at MAX_DROP files.
 */

export interface Dropped {
  /** The folder it goes into, relative to where it was dropped ("" = right there). */
  dir: string;
  /** null: a folder to make (so empty folders arrive too). */
  file: File | null;
}

export const MAX_DROP = 500;
/** Never carried along from a dropped folder. */
const SKIP = new Set([".DS_Store", "Thumbs.db", "desktop.ini", ".git", "node_modules", "__pycache__", ".venv"]);

/** Whether a drag carries files from the computer (not text, a link or one of McBot's own rows). */
export const hasFiles = (dt: DataTransfer | null): boolean => !!dt && [...dt.types].includes("Files");

/** Read a drop now; the promise walks its folders. */
export function takeDrop(dt: DataTransfer): Promise<{ items: Dropped[]; more: boolean }> {
  const entries = [...dt.items].filter((i) => i.kind === "file").map((i) => i.webkitGetAsEntry?.() ?? null);
  const files = [...dt.files];
  return (async () => {
    const out: Dropped[] = [];
    if (entries.length && entries.every(Boolean)) {
      for (const e of entries) await walk(e!, "", out);
    } else {
      for (const file of files.slice(0, MAX_DROP)) out.push({ dir: "", file });
    }
    const count = out.filter((d) => d.file).length;
    return { items: out, more: count >= MAX_DROP || files.length > MAX_DROP };
  })();
}

async function walk(entry: FileSystemEntry, dir: string, out: Dropped[]): Promise<void> {
  if (SKIP.has(entry.name) || out.filter((d) => d.file).length >= MAX_DROP) return;
  if (entry.isFile) {
    const file = await new Promise<File | null>((res) => (entry as FileSystemFileEntry).file(res, () => res(null)));
    if (file) out.push({ dir, file });
    return;
  }
  if (!entry.isDirectory) return;
  const sub = dir ? `${dir}/${entry.name}` : entry.name;
  out.push({ dir: sub, file: null });
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // A folder comes in batches until one is empty.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((res) => reader.readEntries(res, () => res([])));
    if (!batch.length) break;
    for (const e of batch) await walk(e, sub, out);
  }
}

/**
 * The top-level names of a drop, made free in the folder it lands in, so a dropped folder never
 * mixes into one that is there ("docs" → "docs 2"); files keep their names (the engine makes those
 * free itself).
 */
export function placeDrop(items: readonly Dropped[], taken: ReadonlySet<string>, free: (want: string) => string): Dropped[] {
  const renamed = new Map<string, string>();
  for (const d of items) {
    if (d.file || d.dir.includes("/")) continue;
    if (!renamed.has(d.dir)) renamed.set(d.dir, taken.has(d.dir.toLowerCase()) ? free(d.dir) : d.dir);
  }
  return items.map((d) => {
    if (!d.dir) return d;
    const top = d.dir.split("/")[0]!;
    const to = renamed.get(top) ?? top;
    return to === top ? d : { ...d, dir: to + d.dir.slice(top.length) };
  });
}
