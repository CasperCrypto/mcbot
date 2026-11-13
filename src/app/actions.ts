import { exportText, nameFromFile } from "../board/files";
import { engine, EngineError } from "./lib/engine";
import { canReveal, revealFile } from "./lib/open";
import { useApp } from "./state/store";

const changedCount = (r: Awaited<ReturnType<typeof engine.compile>>) => (r.ok ? r.report.changes.filter((c) => c.status !== "unchanged").length : 0);

export async function compileBoard(boardId: string, opts: { quiet?: boolean } = {}): Promise<boolean> {
  const app = useApp.getState();
  app.setCompile({ compileBusy: true });
  try {
    const res = await engine.compile(boardId);
    // The compile sheet (files and diffs) opens only when asked for; a compile says how it went in
    // a notice, and a board with problems points at the first block to fix.
    app.setCompile({ compile: res, compileOpen: false, drift: res.ok ? 0 : null });
    const showFiles = { label: "Files", run: () => { const a = useApp.getState(); a.setTab("graph"); a.setCompile({ compileOpen: true }); } };
    if (res.ok) {
      const n = changedCount(res);
      if (!opts.quiet) app.toast({ kind: "ok", text: n ? `Compiled · ${n} file${n === 1 ? "" : "s"} updated` : "Compiled · already up to date", action: showFiles });
    } else {
      const errors = res.issues.filter((i) => i.level === "error");
      const first = errors.find((i) => i.nodeId);
      app.toast({
        kind: "fail",
        text: errors.length ? `${errors.length} thing${errors.length === 1 ? "" : "s"} to fix first: ${errors[0]!.message}` : res.error,
        action: first ? { label: "Fix", run: () => { const a = useApp.getState(); a.setTab("graph"); a.select(first.nodeId!); } } : undefined,
      });
    }
    return res.ok;
  } catch (err) {
    app.toast({ kind: "fail", text: (err as Error).message });
    return false;
  } finally {
    app.setCompile({ compileBusy: false });
  }
}

/** Dry-run compile: how many files on disk differ from the board right now. */
export async function refreshDrift(boardId: string): Promise<void> {
  try {
    const res = await engine.preview(boardId);
    useApp.getState().setCompile({ drift: res.ok ? changedCount(res) : null });
  } catch {
    useApp.getState().setCompile({ drift: null });
  }
}

export async function runAgent(boardId: string, agentNodeId: string, prompt: string): Promise<string | null> {
  const app = useApp.getState();
  // Until the run's first event arrives, the agent counts as busy (the chat's queue waits for it).
  app.setStarting(agentNodeId, true);
  try {
    const { runId } = await engine.startRun(boardId, agentNodeId, prompt);
    app.selectRun(runId);
    setTimeout(() => useApp.getState().setStarting(agentNodeId, false), 800);
    return runId;
  } catch (err) {
    app.setStarting(agentNodeId, false);
    if (err instanceof EngineError && err.status === 409 && err.body.stale) {
      app.toast({
        kind: "fail",
        text: err.message,
        action: { label: "Compile & run", run: () => void compileBoard(boardId, { quiet: true }).then((ok) => (ok ? runAgent(boardId, agentNodeId, prompt) : null)) },
      });
    } else {
      app.toast({ kind: "fail", text: (err as Error).message });
    }
    return null;
  }
}

/** Save the board as a file: into the McBot folder's exports/ (desktop), or a download (browser demo). */
export async function exportBoardFile(boardId: string): Promise<void> {
  const app = useApp.getState();
  try {
    const res = await engine.exportBoard(boardId);
    if (res.path) {
      const path = res.path;
      app.toast({ kind: "ok", text: `Exported to ${res.shown ?? path}`, action: canReveal() ? { label: "Show", run: () => void revealFile(path) } : undefined });
      return;
    }
    const url = URL.createObjectURL(new Blob([exportText(res.graph)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: res.file });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    app.toast({ kind: "ok", text: `Downloaded ${res.file}` });
  } catch (err) {
    app.toast({ kind: "fail", text: (err as Error).message });
  }
}

/** Draw this computer's Hermes setup (~/.hermes) as a new board. */
export async function openHermesSetup(): Promise<void> {
  const app = useApp.getState();
  try {
    const b = await engine.openHermes();
    app.setBoards(await engine.boards());
    app.setBoard(b.id);
    app.setTab("graph");
    const more = b.unshown.length ? ` · ${b.unshown.length} not shown yet (see the gray note)` : "";
    app.toast({ kind: "ok", text: `Opened your Hermes setup${more}` });
  } catch (err) {
    app.toast({ kind: "fail", text: (err as Error).message });
  }
}

/** Pick a board file and open it as a new board. Nothing existing is replaced. */
export function importBoardFile(): void {
  const input = Object.assign(document.createElement("input"), { type: "file", accept: ".json,application/json" });
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const app = useApp.getState();
    try {
      let graph: unknown;
      try {
        graph = JSON.parse(await file.text());
      } catch {
        throw new Error("This file isn't a McBot board.");
      }
      const b = await engine.importBoard(graph, nameFromFile(file.name));
      app.setBoards(await engine.boards());
      app.setBoard(b.id);
      app.setTab("graph");
      app.toast({ kind: "ok", text: `Imported “${b.name}”` });
    } catch (err) {
      app.toast({ kind: "fail", text: (err as Error).message });
    }
  };
  input.click();
}
