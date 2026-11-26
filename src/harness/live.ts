/** Board edits from src/harness/reconcile.ts applied to a live shared board (one transaction). */
import type * as Y from "yjs";
import { addEdge, addNode, removeEdges, setNodeField, updateEdge } from "../board/ydoc";
import type { BoardEdit } from "./reconcile";

export function applyToDoc(doc: Y.Doc, edits: readonly BoardEdit[]): void {
  doc.transact(() => {
    for (const e of edits) {
      if (e.op === "set") setNodeField(doc, e.id, e.field, e.value);
      else if (e.op === "add-node") addNode(doc, e.node);
      else if (e.op === "add-edge") addEdge(doc, e.edge);
      else if (e.op === "edge-order") updateEdge(doc, e.id, { order: e.order });
      else removeEdges(doc, e.ids);
    }
  });
}

/** What an agent's settings folder holds that the editor may save (engine/folders.ts uses the same rule). */
export function agentEditable(path: string): boolean {
  return path.startsWith("workspace/") || ["SOUL.md", "config.yaml", "profile.yaml"].includes(path) || /^skills\/[a-z0-9][a-z0-9_-]{0,63}\/SKILL\.md$/.test(path);
}

/**
 * Files that hold keys: agents' .env, and McBot's own (API keys, logins and their key, who joined).
 * The Files view never lists, shows, edits or makes one (engine/folders.ts; the demo too).
 */
export const SECRET_FILES: ReadonlySet<string> = new Set([".env", ".op.env", "secrets.json", "logins.json", "logins.key", "sharing.json"]);

/** A file or folder name as typed or dropped: no path, no control or reserved characters; never "." or "..". */
export function safeName(name: string): string | null {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f<>:"|?*]/g, "").trim().slice(0, 200);
  return clean && clean !== "." && clean !== ".." ? clean : null;
}

/** A path as given, in POSIX form with no empty or "." parts ("a/./b/" → "a/b"; "." → ""). */
export const normal = (p: string): string => p.replace(/\\/g, "/").split("/").filter((x) => x && x !== ".").join("/");

/**
 * Whether `path` (normal POSIX, in Files root `rootId`) may be renamed, moved or deleted: anything in
 * an opened folder or the shared files folder, and in an agent's folder only inside workspace/ (its
 * settings are edited, never moved or removed; memory, logs and state are Hermes'). The engine
 * enforces it (engine/folders.ts); the Files view only offers what it allows.
 */
export function changeable(rootId: string, path: string): boolean {
  if (!path) return false;
  return !rootId.startsWith("profile:") || (path.startsWith("workspace/") && path.length > "workspace/".length);
}

/** Whether new files and folders may go into folder `dir` ("" = the root). */
export function addable(rootId: string, dir: string): boolean {
  return !rootId.startsWith("profile:") || dir === "workspace" || dir.startsWith("workspace/");
}
