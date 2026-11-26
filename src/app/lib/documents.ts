/**
 * Documents for the agents (Knowledge → Business): each file goes to the engine, which keeps the
 * original in files/knowledge/ and reads it to text (PDF and Office files through McBot's Hermes);
 * the text goes on the board (`docs`), and the next compile gives every agent that can load skills a
 * `business-files` skill with it. Used by Business and by Memory (a file too big for memory).
 */
import type * as Y from "yjs";
import { addDoc } from "../../board/ydoc";
import { DOC_TEXT_MAX, type Doc } from "../../contracts/graph";
import { compileBoard } from "../actions";
import { useApp } from "../state/store";
import { engine } from "./engine";

const newDocId = () => `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Add files as documents; `adding` hears each file start and end (to show it while it is read). Resolves to the names added. */
export async function addDocuments(doc: Y.Doc, boardId: string, files: readonly File[], adding?: (name: string, on: boolean) => void): Promise<string[]> {
  const { toast, identity } = useApp.getState();
  const added: string[] = [];
  for (const file of files) {
    adding?.(file.name, true);
    try {
      const r = await engine.addDoc(file.name, file);
      const d: Doc = { id: newDocId(), name: r.name, text: r.text, bytes: r.bytes, by: identity.name, at: Date.now() };
      addDoc(doc, d);
      added.push(r.name);
      if (r.truncated) toast({ kind: "info", text: `${r.name} is long: the agents get its first ${Math.round(DOC_TEXT_MAX / 1000)}k characters` });
    } catch (err) {
      toast({ kind: "fail", text: `${file.name}: ${(err as Error).message}` });
    } finally {
      adding?.(file.name, false);
    }
  }
  if (added.length) void compileBoard(boardId, { quiet: true });
  return added;
}
