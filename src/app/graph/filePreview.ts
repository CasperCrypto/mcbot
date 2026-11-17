/** Live files (LiveFiles.tsx): the pure parts, so tests need no window. */
import { applyPatch, diffLines } from "diff";
import type { FileChange } from "../../contracts/compile";

/** `profiles/<agent>/<rest>` → the Files root and path the engine reads it from. */
export const diskPath = (path: string): { root: string; rel: string } | null => {
  const m = /^profiles\/([^/]+)\/(.+)$/.exec(path);
  return m ? { root: `profile:${m[1]}`, rel: m[2]! } : null;
};

/** The file's text after Compile: what is on disk with the dry run's diff applied. */
export function afterText(before: string, change: FileChange): string | null {
  if (change.status === "unchanged") return before;
  if (change.status === "removed") return "";
  const out = applyPatch(before, change.diff);
  return out === false ? null : out;
}

type Line = { kind: "add" | "del" | "same"; text: string };
export function fileLines(before: string, after: string): Line[] {
  const out: Line[] = [];
  for (const part of diffLines(before, after)) {
    const kind = part.added ? "add" : part.removed ? "del" : "same";
    const lines = part.value.replace(/\n$/, "").split("\n");
    for (const text of lines) out.push({ kind, text });
  }
  return out;
}
