/**
 * Undo and redo for the board: Yjs' own UndoManager over the parts the board draws (blocks,
 * wires, notes, frames, the board's name), never team chat.
 *
 * It tracks only this window's own edits: local transactions have no origin (`null`), while
 * edits from teammates, other windows and the engine arrive through the provider with the
 * provider as origin. So ⌘Z never takes back someone else's work. Edits within CAPTURE_MS of each
 * other (a drag, typing in the inspector) are one step.
 */
import * as Y from "yjs";
import { boardMaps } from "./ydoc";

export const CAPTURE_MS = 600;
const managers = new WeakMap<Y.Doc, Y.UndoManager>();

export function undoManager(doc: Y.Doc): Y.UndoManager {
  let m = managers.get(doc);
  if (!m) {
    const { meta, nodes, edges, notes, frames } = boardMaps(doc);
    m = new Y.UndoManager([meta, nodes, edges, notes, frames], { captureTimeout: CAPTURE_MS, trackedOrigins: new Set([null]) });
    managers.set(doc, m);
  }
  return m;
}

/** Undo this window's last edit; false when there is nothing to undo. */
export function undo(doc: Y.Doc): boolean {
  return undoManager(doc).undo() !== null;
}

export function redo(doc: Y.Doc): boolean {
  return undoManager(doc).redo() !== null;
}

/** Start a new step now (e.g. before a second, separate action within CAPTURE_MS). */
export function stopCapturing(doc: Y.Doc): void {
  undoManager(doc).stopCapturing();
}
