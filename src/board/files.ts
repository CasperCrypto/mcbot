/** A board as a file (`mcbot.graph/v1` JSON): its name and its text. Pure, so the engine and the browser demo share it. */
import type { Graph } from "../contracts/graph";

export const EXPORT_EXT = ".mcbot.json";

/** A file name for a board: its name in lowercase words (accents dropped), never empty, not taken yet. */
export function exportFileName(name: string, taken: (file: string) => boolean = () => false): string {
  const base = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "board";
  for (let n = 1; ; n++) {
    const file = `${base}${n === 1 ? "" : `-${n}`}${EXPORT_EXT}`;
    if (!taken(file)) return file;
  }
}

/** The exported text: the board as the relay keeps it, pretty-printed, one trailing newline. */
export function exportText(graph: Graph): string {
  return `${JSON.stringify(graph, null, 2)}\n`;
}

/** A file name without its board extension, as a name for a board that has none. */
export function nameFromFile(file: string): string {
  return file.replace(/\.mcbot\.json$|\.json$/i, "").trim();
}
