/**
 * A board as a file: export writes `mcbot.graph/v1` JSON into <workspace>/exports/,
 * import reads one back as a new board. Boards carry only the names of keys,
 * never their values, so an exported file holds no secrets.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { exportFileName, exportText } from "../src/board/files";
import type { Graph } from "../src/contracts/graph";

export { exportFileName, exportText };

/** Write the board into `dir` without overwriting an earlier export. */
export async function writeExport(dir: string, graph: Graph): Promise<{ file: string; path: string; shown: string }> {
  await mkdir(dir, { recursive: true });
  for (;;) {
    const file = exportFileName(graph.name, (f) => existsSync(join(dir, f)));
    const path = join(dir, file);
    try {
      await writeFile(path, exportText(graph), { flag: "wx" }); // "wx": fail rather than overwrite
      const home = homedir();
      return { file, path, shown: home.length > 1 && path.startsWith(home) ? `~${path.slice(home.length)}` : path };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
}
