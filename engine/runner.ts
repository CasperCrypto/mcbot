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
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { ModelNode } from "../src/contracts/graph";
import { priceSession } from "./cost";
import { chatArgv, hermesCommand, hermesEnv, prepareHermes, stopGateway, type HermesBinary } from "./hermes";
import { readSession } from "./hermesData";
import { RunStore, newRunId } from "./runStore";
import { StreamMapper, type ToolNodeRef } from "./streamJson";
import { resolveInside } from "./fsutil";
import { writeProfileKeys } from "./profileEnv";

export interface StartRun {
  boardId: string;
  agentNodeId: string;
  profile: string;
  prompt: string;
  toolNodes: ToolNodeRef[];
  models: ModelNode[];
  /** Key variables this agent's board names (engine/profileEnv.ts keyNamesFor). */
  keyNames?: string[];
}

export interface RunnerOptions {
  store: RunStore;
  root: string;
  /** May the engine stop the gateway under `root`? Only for McBot's own output root. */
  managedRoot: boolean;
  findHermes: () => Promise<HermesBinary | null>;
  /**
   * API keys the user saved in McBot. A run gets them as environment variables, and the
   * ones its agent names are written to the profile's .env, which is where Hermes' gateway
   * reads a served profile's keys (engine/profileEnv.ts).
   */
  secrets?: () => Promise<Record<string, string>>;
}

/** The gateway was booting or shutting down when the client connected (hermes_cli/gateway_chat.py). */
const GATEWAY_NOT_READY = /Gateway (starting|draining)/i;

export class Runner {
  private readonly active = new Map<string, { child: ChildProcess | null; profile: string; cancelled?: boolean }>();
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
    run.cancelled = true;
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
    const bin = await this.opts.findHermes();
    const argv = chatArgv(req.profile, bin ?? undefined);
    const cwd = resolveInside(root, `profiles/${req.profile}/workspace`);
    this.active.set(runId, { child: null, profile: req.profile });
    store.emit(runId, { type: "run.started", boardId: req.boardId, agentNodeId: req.agentNodeId, profile: req.profile, prompt: req.prompt, argv, hermesHome: root, cwd });

    void this.execute(runId, req, argv, cwd, bin).finally(() => this.active.delete(runId));
    return runId;
  }

  private async execute(runId: string, req: StartRun, argv: string[], cwd: string, found: HermesBinary | null): Promise<void> {
    const { store, root } = this.opts;
    const started = Date.now();
    const bin = found && (await prepareHermes(found, root, (line) => store.emit(runId, { type: "run.log", stream: "stderr", line })));
    if (!bin) {
      store.emit(runId, { type: "run.finished", status: "failed", exitCode: null, text: "", tokens: null, durationMs: 0, sessionId: null, error: "Hermes not found: install it or set MCBOT_HERMES_BIN" });
      return;
    }
    await this.refreshGateway(runId, bin);

    const stderrTail: string[] = [];
    let sessionId: string | null = null;
    const saved: Record<string, string> = (await this.opts.secrets?.().catch(() => ({}))) ?? {};
    const env = hermesEnv(root, { ...process.env, ...saved });
    const keys = Object.fromEntries((req.keyNames ?? []).filter((n) => n in saved).map((n) => [n, saved[n]!]));
    await writeProfileKeys(join(root, "profiles", req.profile), keys).catch((err: Error) =>
      store.emit(runId, { type: "run.log", stream: "stderr", line: `[mcbot] could not write this agent's keys: ${err.message}` }));

    /** One Hermes process. A first attempt holds back "the gateway is still starting" so it can be retried. */
    const attempt = (retryable: boolean) => new Promise<{ exit: { code: number | null; signal: string | null; error?: Error }; mapper: StreamMapper; held: boolean }>((resolve) => {
      const mapper = new StreamMapper(req.toolNodes);
      let held = false;
      const cmd = hermesCommand(bin, argv, env);
      const child = spawn(cmd.file, cmd.args, { cwd, env: cmd.env, shell: bin.shell, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      const entry = this.active.get(runId);
      if (entry) entry.child = child;
      child.on("error", (error) => resolve({ exit: { code: null, signal: null, error }, mapper, held }));
      child.on("close", (code, signal) => resolve({ exit: { code, signal }, mapper, held }));

      createInterface({ input: child.stdout! }).on("line", (line) => {
        for (const e of mapper.feed(line)) {
          if (retryable && e.type === "run.finished" && e.status === "failed" && GATEWAY_NOT_READY.test(e.error ?? "")) {
            held = true;
            continue;
          }
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

    // A new Hermes home's gateway can take longer to boot than the client waits ("Gateway starting:
    // deadline"); by then it is up, so one more attempt answers.
    let { exit, mapper, held } = await attempt(true);
    if (held && !this.active.get(runId)?.cancelled) {
      store.emit(runId, { type: "run.log", stream: "stderr", line: "[mcbot] Hermes' gateway was still starting; trying again" });
      ({ exit, mapper } = await attempt(false));
    }

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
