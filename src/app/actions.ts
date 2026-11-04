import { engine, EngineError } from "./lib/engine";
import { useApp } from "./state/store";

const changedCount = (r: Awaited<ReturnType<typeof engine.compile>>) => (r.ok ? r.report.changes.filter((c) => c.status !== "unchanged").length : 0);

export async function compileBoard(boardId: string, opts: { quiet?: boolean } = {}): Promise<boolean> {
  const app = useApp.getState();
  app.setCompile({ compileBusy: true });
  try {
    const res = await engine.compile(boardId);
    app.setCompile({ compile: res, compileOpen: !opts.quiet || !res.ok, drift: res.ok ? 0 : null });
    if (res.ok) {
      const n = changedCount(res);
      if (!opts.quiet) app.toast({ kind: "ok", text: n ? `Compiled — ${n} file${n === 1 ? "" : "s"} written to ${res.report.root}` : "Compiled — already up to date" });
    } else {
      app.toast({ kind: "fail", text: res.error });
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
  try {
    const { runId } = await engine.startRun(boardId, agentNodeId, prompt);
    app.selectRun(runId);
    return runId;
  } catch (err) {
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
