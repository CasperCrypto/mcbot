/**
 * Launches one Hermes turn for a compiled agent and turns its output into run
 * events (contract 3):
 *
 *   HERMES_HOME=<root> hermes -p <profile> chat --query-file - --oneshot --format stream-json
 *
 * cwd is the profile's workspace/, the prompt goes on stdin. When the process
 * exits the engine reads the session's row from the profile's state.db and
 * emits run.cost.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { ModelNode } from "../src/contracts/graph";
import { priceSession } from "./cost";
import { chatArgv, hermesEnv, stopGateway, type HermesBinary } from "./hermes";
import { readSession } from "./hermesData";
import { RunStore, newRunId } from "./runStore";
import { StreamMapper, type ToolNodeRef } from "./streamJson";
import { resolveInside } from "./fsutil";

export interface StartRun {
  boardId: string;
  agentNodeId: string;
  profile: string;
  prompt: string;
  toolNodes: ToolNodeRef[];
  models: ModelNode[];
}

export interface RunnerOptions {
  store: RunStore;
  root: string;
  /** May the engine stop the gateway under `root`? Only for McBot's own output root. */
  managedRoot: boolean;
  findHermes: () => Promise<HermesBinary | null>;
  /** API keys the user saved in McBot, passed to Hermes as environment variables. */
  secrets?: () => Promise<Record<string, string>>;
}

export class Runner {
  private readonly active = new Map<string, { child: ChildProcess | null; profile: string }>();
  private gatewayStale = false;
  private gatewayRestart: Promise<void> | null = null;

  constructor(private readonly opts: RunnerOptions) {}

  /** A compile changed a config.yaml: the running gateway must not serve the old one. */
  markGatewayStale(): void {
    this.gatewayStale = true;
  }

  isBusy(profile: string): boolean {
    return [...this.active.values()].some((r) => r.profile === profile);
  }

  activeRuns(): string[] {
    return [...this.active.keys()];
  }

  cancel(runId: string): boolean {
    const run = this.active.get(runId);
    if (!run?.child) return false;
    run.child.kill(process.platform === "win32" ? undefined : "SIGINT");
    return true;
  }

  private async refreshGateway(runId: string, bin: HermesBinary): Promise<void> {
    if (!this.gatewayStale || !this.opts.managedRoot) return;
    this.gatewayStale = false;
    this.gatewayRestart ??= (async () => {
      const started = Date.now();
      const result = await stopGateway(bin, this.opts.root);
      this.opts.store.emit(runId, { type: "run.log", stream: "stderr", line: `[mcbot] hermes gateway ${result} after recompile (${Date.now() - started} ms); a fresh one starts with this run` });
    })().finally(() => (this.gatewayRestart = null));
    await this.gatewayRestart;
  }

  async start(req: StartRun): Promise<string> {
    const { store, root } = this.opts;
    const runId = newRunId();
    const argv = chatArgv(req.profile);
    const cwd = resolveInside(root, `profiles/${req.profile}/workspace`);
    this.active.set(runId, { child: null, profile: req.profile });
    store.emit(runId, { type: "run.started", boardId: req.boardId, agentNodeId: req.agentNodeId, profile: req.profile, prompt: req.prompt, argv, hermesHome: root, cwd });

    void this.execute(runId, req, argv, cwd).finally(() => this.active.delete(runId));
    return runId;
  }

  private async execute(runId: string, req: StartRun, argv: string[], cwd: string): Promise<void> {
    const { store, root } = this.opts;
    const started = Date.now();
    const bin = await this.opts.findHermes();
    if (!bin) {
      store.emit(runId, { type: "run.finished", status: "failed", exitCode: null, text: "", tokens: null, durationMs: 0, sessionId: null, error: "Hermes not found: install it or set MCBOT_HERMES_BIN" });
      return;
    }
    await this.refreshGateway(runId, bin);

    const mapper = new StreamMapper(req.toolNodes);
    const stderrTail: string[] = [];
    let sessionId: string | null = null;

    const env = hermesEnv(root, { ...process.env, ...((await this.opts.secrets?.().catch(() => ({}))) ?? {}) });
    const exit = await new Promise<{ code: number | null; signal: string | null; error?: Error }>((resolve) => {
      const child = spawn(bin.path, argv, { cwd, env, shell: bin.shell, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      const entry = this.active.get(runId);
      if (entry) entry.child = child;
      child.on("error", (error) => resolve({ code: null, signal: null, error }));
      child.on("close", (code, signal) => resolve({ code, signal }));

      createInterface({ input: child.stdout! }).on("line", (line) => {
        for (const e of mapper.feed(line)) {
          if (e.type === "run.session") sessionId = e.sessionId;
          if (e.type === "run.finished" && e.sessionId) sessionId = e.sessionId;
          store.emit(runId, e);
        }
      });
      createInterface({ input: child.stderr! }).on("line", (line) => {
        stderrTail.push(line);
        if (stderrTail.length > 40) stderrTail.shift();
        store.emit(runId, { type: "run.log", stream: "stderr", line });
      });
      child.stdin!.on("error", () => undefined);
      child.stdin!.end(req.prompt);
    });

    if (exit.error) {
      store.emit(runId, { type: "run.finished", status: "failed", exitCode: null, text: "", tokens: null, durationMs: Date.now() - started, sessionId: null, error: `could not start hermes: ${exit.error.message}` });
      return;
    }
    const tail = mapper.finish(exit.code, exit.signal, Date.now() - started, stderrTail);
    if (tail) store.emit(runId, tail);

    if (sessionId) {
      try {
        const row = readSession(root, req.profile, sessionId);
        if (row) {
          const priced = priceSession(row, req.models);
          store.emit(runId, {
            type: "run.cost",
            sessionId,
            model: row.model,
            provider: row.billingProvider,
            reportedUsd: row.estimatedCostUsd,
            costStatus: row.costStatus,
            estimatedUsd: priced.source === "estimate" ? priced.usd : null,
          });
        }
      } catch (err) {
        store.emit(runId, { type: "run.log", stream: "stderr", line: `[mcbot] could not read state.db for cost: ${(err as Error).message}` });
      }
    }
  }
}
