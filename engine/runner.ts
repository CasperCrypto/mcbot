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
import { chatArgv, ensureGateway, gatewayStatus, hermesCommand, hermesEnv, prepareHermes, stopGateway, type HermesBinary } from "./hermes";
import { readSession } from "./hermesData";
import { RunStore, newRunId } from "./runStore";
import { StreamMapper, type ToolNodeRef } from "./streamJson";
import { resolveInside } from "./fsutil";
import { resolveEntries, writeProfileKeys, type EnvEntry } from "./profileEnv";
import { HermesRuns, RunsApiMapper, isTerminal } from "./hermesRuns";

export interface StartRun {
  boardId: string;
  agentNodeId: string;
  profile: string;
  prompt: string;
  toolNodes: ToolNodeRef[];
  models: ModelNode[];
  /** What this agent's .env holds from the board (engine/profileEnv.ts envEntriesFor). */
  env?: EnvEntry[];
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
  /**
   * McBot's own Hermes runs through the gateway's runs API (engine/hermesRuns.ts), so a run can
   * ask the person before a risky action. `env` turns the API server on (in every .env).
   */
  api?: { runs: HermesRuns; env: Record<string, string> };
}

/** The gateway was booting or shutting down when the client connected (hermes_cli/gateway_chat.py). */
const GATEWAY_NOT_READY = /Gateway (starting|draining)/i;
/** How long a stopped run may take to wind down before McBot ends it. */
export const STOP_GRACE_MS = 4000;

export class Runner {
  private readonly active = new Map<string, { child: ChildProcess | null; profile: string; startedAt: number; cancelled?: boolean; finished?: boolean; hermesRunId?: string; abort?: AbortController }>();
  private gatewayStale = false;
  private gatewayRestart: Promise<void> | null = null;
  private gatewayEnsure: Promise<unknown> = Promise.resolve();

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

  /**
   * Stop a run, whatever it is doing. Hermes' runs API stops at its next step, so a long model
   * answer, a tool or a pending approval would keep it going: after STOP_GRACE_MS McBot stops
   * listening and ends the run itself. A one-shot process gets SIGINT, then SIGTERM, then SIGKILL.
   * A run that is still starting is stopped before Hermes is asked.
   */
  cancel(runId: string): boolean {
    const run = this.active.get(runId);
    if (!run) return false;
    if (run.cancelled) return true;
    run.cancelled = true;
    this.opts.store.emit(runId, { type: "run.log", stream: "stderr", line: "[mcbot] stopping" });
    if (run.hermesRunId && this.opts.api) void this.opts.api.runs.stop(run.profile, run.hermesRunId);
    const child = run.child;
    if (child) child.kill(process.platform === "win32" ? undefined : "SIGINT");
    setTimeout(() => {
      if (!this.active.has(runId)) return;
      if (child && child.exitCode === null) child.kill(process.platform === "win32" ? undefined : "SIGTERM");
      run.abort?.abort();
      this.endStopped(runId);
      setTimeout(() => { if (child && child.exitCode === null) child.kill("SIGKILL"); }, STOP_GRACE_MS);
    }, STOP_GRACE_MS);
    return true;
  }

  /** Every event of a run goes through here, so a run finishes once (a stopped run may still report). */
  private emit(runId: string, e: Parameters<RunStore["emit"]>[1]): void {
    const run = this.active.get(runId);
    if (e.type === "run.finished") {
      if (run?.finished) return;
      if (run) run.finished = true;
    }
    this.opts.store.emit(runId, e);
  }

  /** The person stopped it: one `run.finished` (interrupted), unless the run already finished. */
  private endStopped(runId: string): void {
    const run = this.active.get(runId);
    if (!run || run.finished) return;
    run.finished = true;
    this.opts.store.emit(runId, { type: "run.finished", status: "interrupted", exitCode: null, text: "", tokens: null, durationMs: Date.now() - run.startedAt, sessionId: null, error: "Stopped" });
  }

  private async refreshGateway(runId: string, bin: HermesBinary): Promise<void> {
    if (!this.gatewayStale || !this.opts.managedRoot) return;
    this.gatewayStale = false;
    this.gatewayRestart ??= (async () => {
      const started = Date.now();
      const result = await stopGateway(bin, this.opts.root);
      this.opts.store.emit(runId, { type: "run.log", stream: "stderr", line: `[mcbot] engine gateway ${result} after recompile (${Date.now() - started} ms); a fresh one starts with this run` });
    })().finally(() => (this.gatewayRestart = null));
    await this.gatewayRestart;
  }

  /**
   * Keep the gateway up for chat apps: restart it first if a compile made it stale (McBot's own
   * root only), then `hermes gateway ensure`. Calls are serialized. Resolves to what happened.
   */
  ensureGateway(): Promise<string> {
    const next = this.gatewayEnsure.then(async () => {
      const found = await this.opts.findHermes();
      if (!found) return "no hermes";
      if (!this.gatewayStale && (await gatewayStatus(this.opts.root)).running) return "running";
      const bin = await prepareHermes(found, this.opts.root);
      if (this.gatewayStale && this.opts.managedRoot) {
        this.gatewayStale = false;
        await stopGateway(bin, this.opts.root);
      }
      const code = await ensureGateway(bin, this.opts.root);
      return code === 0 ? "ready" : `ensure exited ${code}`;
    });
    this.gatewayEnsure = next.catch(() => "failed");
    return next;
  }

  /**
   * Answer the question a run is waiting on (an approval card): once, session, always or deny.
   * Only runs through the runs API can ask.
   */
  async answer(runId: string, choice: string): Promise<void> {
    const run = this.active.get(runId);
    if (!run?.hermesRunId || !this.opts.api) throw new Error("This run is not waiting for an answer");
    const events = await this.opts.store.events(runId);
    const settled = new Set(events.filter((e) => e.type === "run.approval.settled").map((e) => (e as { promptId: string }).promptId));
    const ask = [...events].reverse().find((e) => e.type === "run.approval" && !settled.has(e.promptId));
    if (!ask || ask.type !== "run.approval") throw new Error("This run is not waiting for an answer");
    if (!ask.choices.includes(choice)) throw new Error(`Choose one of: ${ask.choices.join(", ")}`);
    await this.opts.api.runs.answer(run.profile, run.hermesRunId, ask.promptId, ask.generation, choice);
  }

  /** Turn the gateway's API server on for this root and make sure it answers (restarting a gateway that started without it). */
  private async ensureApi(runId: string, bin: HermesBinary): Promise<boolean> {
    const api = this.opts.api!;
    await writeProfileKeys(this.opts.root, api.env);
    if (await api.runs.up()) return true;
    if (this.opts.managedRoot && (await gatewayStatus(this.opts.root)).running) {
      this.opts.store.emit(runId, { type: "run.log", stream: "stderr", line: "[mcbot] restarting the engine gateway with its runs API" });
      await stopGateway(bin, this.opts.root);
    }
    await this.ensureGateway();
    for (const end = Date.now() + 90_000; Date.now() < end;) {
      if (await api.runs.up()) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }

  /** One run through Hermes' runs API: events as they happen, questions to the person, cost at the end. */
  private async executeApi(runId: string, req: StartRun, bin: HermesBinary): Promise<void> {
    const { store, root } = this.opts;
    const api = this.opts.api!;
    const started = Date.now();
    await this.refreshGateway(runId, bin);
    const saved: Record<string, string> = (await this.opts.secrets?.().catch(() => ({}))) ?? {};
    await writeProfileKeys(join(root, "profiles", req.profile), { ...resolveEntries(req.env ?? [], saved), ...api.env }).catch((err: Error) =>
      this.emit(runId, { type: "run.log", stream: "stderr", line: `[mcbot] could not write this agent's keys: ${err.message}` }));
    const fail = (error: string): void => {
      this.emit(runId, { type: "run.finished", status: "failed", exitCode: null, text: "", tokens: null, durationMs: Date.now() - started, sessionId: null, error });
    };
    if (!(await this.ensureApi(runId, bin))) return fail("The engine gateway did not start its runs API");
    const entry = this.active.get(runId);
    if (entry?.cancelled) return this.endStopped(runId);
    let hermesRunId: string;
    try {
      hermesRunId = await api.runs.start(req.profile, req.prompt);
    } catch (err) {
      return fail((err as Error).message);
    }
    const abort = new AbortController();
    if (entry) Object.assign(entry, { hermesRunId, abort });
    if (entry?.cancelled) {
      void api.runs.stop(req.profile, hermesRunId);
      if (entry.finished) abort.abort();
    }
    const mapper = new RunsApiMapper(req.toolNodes);
    let finished = false;
    try {
      for await (const e of api.runs.events(req.profile, hermesRunId, abort.signal)) {
        for (const ev of mapper.map(e, started)) {
          if (ev.type === "run.finished") {
            const sessionId = await api.runs.sessionOf(req.profile, hermesRunId);
            this.emit(runId, { ...ev, sessionId });
            finished = true;
            if (sessionId) this.emitCost(runId, req, sessionId);
          } else {
            this.emit(runId, ev);
          }
        }
        if (isTerminal(e)) break;
      }
    } catch (err) {
      if (!finished) fail(`Lost the run's events: ${(err as Error).message}`);
      return;
    }
    if (!finished) fail("The run ended without a result");
  }

  private emitCost(runId: string, req: StartRun, sessionId: string): void {
    const { store, root } = this.opts;
    try {
      const row = readSession(root, req.profile, sessionId);
      if (!row) return;
      const priced = priceSession(row, req.models);
      this.emit(runId, {
        type: "run.cost", sessionId, model: row.model, provider: row.billingProvider, reportedUsd: row.estimatedCostUsd,
        costStatus: row.costStatus, estimatedUsd: priced.source === "estimate" ? priced.usd : null,
      });
    } catch (err) {
      this.emit(runId, { type: "run.log", stream: "stderr", line: `[mcbot] could not read state.db for cost: ${(err as Error).message}` });
    }
  }

  async start(req: StartRun): Promise<string> {
    const { store, root } = this.opts;
    const runId = newRunId();
    const bin = await this.opts.findHermes();
    const viaApi = !!this.opts.api && bin?.kind === "bundled";
    const argv = viaApi ? ["runs-api", "/p/" + req.profile + "/v1/runs"] : chatArgv(req.profile, bin ?? undefined);
    const cwd = resolveInside(root, `profiles/${req.profile}/workspace`);
    this.active.set(runId, { child: null, profile: req.profile, startedAt: Date.now() });
    this.emit(runId, { type: "run.started", boardId: req.boardId, agentNodeId: req.agentNodeId, profile: req.profile, prompt: req.prompt, argv, hermesHome: root, cwd });

    const go = viaApi && bin
      ? prepareHermes(bin, root, (line) => this.emit(runId, { type: "run.log", stream: "stderr", line })).then((b) => this.executeApi(runId, req, b))
      : this.execute(runId, req, argv, cwd, bin);
    void go.catch((err: Error) => this.emit(runId, { type: "run.finished", status: "failed", exitCode: null, text: "", tokens: null, durationMs: 0, sessionId: null, error: err.message }))
      .finally(() => this.active.delete(runId));
    return runId;
  }

  private async execute(runId: string, req: StartRun, argv: string[], cwd: string, found: HermesBinary | null): Promise<void> {
    const { store, root } = this.opts;
    const started = Date.now();
    const bin = found && (await prepareHermes(found, root, (line) => this.emit(runId, { type: "run.log", stream: "stderr", line })));
    if (!bin) {
      this.emit(runId, { type: "run.finished", status: "failed", exitCode: null, text: "", tokens: null, durationMs: 0, sessionId: null, error: "The engine is not set up yet" });
      return;
    }
    await this.refreshGateway(runId, bin);
    if (this.active.get(runId)?.cancelled) return this.endStopped(runId);

    const stderrTail: string[] = [];
    let sessionId: string | null = null;
    const saved: Record<string, string> = (await this.opts.secrets?.().catch(() => ({}))) ?? {};
    const env = hermesEnv(root, { ...process.env, ...saved });
    await writeProfileKeys(join(root, "profiles", req.profile), resolveEntries(req.env ?? [], saved)).catch((err: Error) =>
      this.emit(runId, { type: "run.log", stream: "stderr", line: `[mcbot] could not write this agent's keys: ${err.message}` }));

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
          this.emit(runId, e);
        }
      });
      createInterface({ input: child.stderr! }).on("line", (line) => {
        stderrTail.push(line);
        if (stderrTail.length > 40) stderrTail.shift();
        this.emit(runId, { type: "run.log", stream: "stderr", line });
      });
      child.stdin!.on("error", () => undefined);
      child.stdin!.end(req.prompt);
    });

    // A new Hermes home's gateway can take longer to boot than the client waits ("Gateway starting:
    // deadline"); by then it is up, so one more attempt answers.
    let { exit, mapper, held } = await attempt(true);
    if (held && !this.active.get(runId)?.cancelled) {
      this.emit(runId, { type: "run.log", stream: "stderr", line: "[mcbot] Hermes' gateway was still starting; trying again" });
      ({ exit, mapper } = await attempt(false));
    }

    if (exit.error) {
      this.emit(runId, { type: "run.finished", status: "failed", exitCode: null, text: "", tokens: null, durationMs: Date.now() - started, sessionId: null, error: `could not start hermes: ${exit.error.message}` });
      return;
    }
    const tail = mapper.finish(exit.code, exit.signal, Date.now() - started, stderrTail);
    if (tail) this.emit(runId, tail);

    if (sessionId) {
      try {
        const row = readSession(root, req.profile, sessionId);
        if (row) {
          const priced = priceSession(row, req.models);
          this.emit(runId, {
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
        this.emit(runId, { type: "run.log", stream: "stderr", line: `[mcbot] could not read state.db for cost: ${(err as Error).message}` });
      }
    }
  }
}
