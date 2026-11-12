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
