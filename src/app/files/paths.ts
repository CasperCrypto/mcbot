/**
 * The Files view's pure parts: where a drop lands, what a file is shown as, what an agent is told
 * about a folder. Paths are POSIX and relative to their root ("" is the root itself); a place in
 * the view is `<root id>:<path>` (root ids are `kind:name`, so the path starts after the 2nd colon).
 */
import type { FsEntry, FsRoot } from "../../contracts/api";
import { addable } from "../../harness/live";

export const keyOf = (rootId: string, path: string): string => `${rootId}:${path}`;

/** `<root id>:<path>` back into its parts. */
export function splitKey(key: string): { rootId: string; path: string } {
  const parts = key.split(":");
  return { rootId: parts.slice(0, 2).join(":"), path: parts.slice(2).join(":") };
}

export const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
export const parentOf = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
export const joinPath = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name);
/** "notes.md" → "md"; no dot → "". */
export const extOf = (name: string): string => (name.lastIndexOf(".") > 0 ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "");

/** Whether `path` is `dir` or inside it. */
export const within = (path: string, dir: string): boolean => path === dir || path.startsWith(`${dir}/`);

export type Shown = "text" | "image" | "video" | "audio" | "drawing" | "binary";
const IMAGE = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "avif", "ico", "bmp"]);
const VIDEO = new Set(["mp4", "webm", "mov", "m4v"]);
const AUDIO = new Set(["mp3", "wav", "m4a", "ogg", "flac"]);
/** Files no editor can show as text (they are shown by name and size, and can go to an agent). */
const BINARY = new Set(["pdf", "zip", "gz", "tgz", "7z", "rar", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "key", "pages", "numbers", "odt", "ods", "odp", "epub", "db", "sqlite", "exe", "dmg", "msi", "app", "bin", "woff", "woff2", "ttf", "otf", "heic", "psd", "ai", "sketch", "fig"]);

/** How a file is shown: the editor for text, a player or a picture for media, the canvas for a drawing. */
export function shownAs(name: string): Shown {
  const ext = extOf(name);
  if (name.endsWith(".excalidraw")) return "drawing";
  if (IMAGE.has(ext)) return "image";
  if (VIDEO.has(ext)) return "video";
  if (AUDIO.has(ext)) return "audio";
  if (BINARY.has(ext)) return "binary";
  return "text";
}

/** Text the person reads rather than edits: Markdown opens as a page, with Edit beside it. */
export const readsAsPage = (name: string): boolean => ["md", "markdown", "mdx"].includes(extOf(name));

/**
 * The folder a drop (or New file / New folder) goes into, for the place it is aimed at: a folder is
 * itself, a file its folder, an agent's folder its workspace/ (the one place there that takes files).
 * null where nothing may be added.
 */
export function folderFor(root: FsRoot, path: string, kind: "dir" | "file"): string | null {
  const dir = kind === "dir" ? path : parentOf(path);
  if (root.kind === "profile" && !addable(root.id, dir)) return addable(root.id, "workspace") ? "workspace" : null;
  return addable(root.id, dir) ? dir : null;
}

/** The part of a name Rename selects first: the name without its extension, as in Finder. */
export function stemEnd(name: string): number {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? dot : name.length;
}

/** A free name for a new file or folder in a listing: "untitled.md", then "untitled 2.md"… */
export function freeName(entries: readonly Pick<FsEntry, "name">[], want: string): string {
  const taken = new Set(entries.map((e) => e.name.toLowerCase()));
  if (!taken.has(want.toLowerCase())) return want;
  const dot = want.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [want.slice(0, dot), want.slice(dot)] : [want, ""];
  for (let n = 2; ; n++) if (!taken.has(`${stem} ${n}${ext}`.toLowerCase())) return `${stem} ${n}${ext}`;
}

const SIZE = ["B", "KB", "MB", "GB"];
const size = (n: number) => {
  let i = 0;
  let v = n;
  while (v >= 1024 && i < SIZE.length - 1) { v /= 1024; i++; }
  return `${i ? v.toFixed(v < 10 ? 1 : 0) : v} ${SIZE[i]}`;
};

/** What an agent is told about a folder it is asked about: where it is and what is in it. */
export function folderBrief(absPath: string, entries: readonly FsEntry[], truncated = 0): string {
  const lines = entries.slice(0, 200).map((e) => (e.kind === "dir" ? `- ${e.name}/ (${e.children ?? "?"} items)` : `- ${e.name} (${size(e.bytes)})`));
  const more = entries.length - Math.min(entries.length, 200) + truncated;
  return [`Folder: ${absPath}`, "", ...(lines.length ? lines : ["(empty)"]), ...(more > 0 ? [`- … and ${more} more`] : [])].join("\n");
}

/** A root's absolute path joined with a relative one, with the root's own separator. */
export function absolute(root: FsRoot, path: string): string {
  const sep = root.path.includes("\\") ? "\\" : "/";
  return path ? [root.path.replace(/[\\/]+$/, ""), ...path.split("/")].join(sep) : root.path;
}
