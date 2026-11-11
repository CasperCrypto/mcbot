/**
 * The McBot engine: one local process that is the board relay (M2), the
 * compile writer (M1), the run launcher (M3) and the reader of Hermes data
 * (M4). Loopback only. No auth in v0, so every request must come from an
 * allowed Origin and a loopback Host: a web page in the user's browser must
 * not be able to compile or launch agents (cross-site request / DNS rebinding).
 */
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { z } from "zod";
import { compile, resolveGraph, type AgentBundle } from "../src/compile";
import type { AgentMemoryView, BoardInfo, CompileResponse, Diagnostics, FsListing, FsPreview, FsRoot, Health, HermesInfo, SetupDetect, SetupState } from "../src/contracts/api";
import { diagnosticsText, osLine, redact, tail } from "./diagnostics";
import type { Graph, ModelNode } from "../src/contracts/graph";
import { buildCostReport } from "./cost";
import { atomicWrite } from "./fsutil";
import { FolderError, Folders } from "./folders";
import { bundledHermes, bundledSource, bundledUpstream, findHermes, gatewayStatus, prepareHermes, runHermesSetup, stopGateway } from "./hermes";
import { MemoryConflict, readMemory, readSessions, writeMemory } from "./hermesData";
import { envEntriesFor, hasLiveChannel, resolveEntries, writeProfileKeys } from "./profileEnv";
import { MediaError, mediaFile } from "./media";
import { BOARD_ID_RE, BoardRelay, LooseGraph } from "./relay";
import { Runner } from "./runner";
import { RunStore } from "./runStore";
import { SecretError, Secrets } from "./secrets";
import { SetupStore, detectLocal, listModels } from "./setup";
import { OwnershipError, readManifest, writeCompileResult } from "./writer";

export const ENGINE_VERSION = "0.1.0";

export interface EngineConfig {
  workspace: string;
  hermesHome: string;
  managedRoot: boolean;
  port: number;
  host: string;
  allowedOrigins: string[];
  /** The installed app's engine log (the shell writes it), for "Report a problem"; absent in development. */
  logFile?: string;
}

export const DEFAULT_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173", "tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"];
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly body?: unknown) {
    super(message);
  }
}

async function json(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 2_000_000) throw new HttpError(413, "body too large");
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "board";

export interface Engine {
  server: Server;
  url: string;
  relay: BoardRelay;
  runner: Runner;
  store: RunStore;
  close(): Promise<void>;
}

export async function startEngine(cfg: EngineConfig): Promise<Engine> {
  // A saved board edit can change what an agent's .env holds (a bot's allowed users): sync it.
  let onBoardSaved: (boardId: string) => void = () => undefined;
  const relay = new BoardRelay(join(cfg.workspace, "boards"), (boardId) => onBoardSaved(boardId));
  const store = new RunStore(join(cfg.workspace, "runs"));
  const secrets = new Secrets(join(cfg.workspace, "secrets.json"));
  let setupJob: HermesInfo["setup"] = { state: "idle", lines: [] };
  const setup = new SetupStore(join(cfg.workspace, "setup.json"));
  const runner = new Runner({ store, root: cfg.hermesHome, managedRoot: cfg.managedRoot, findHermes: () => findHermes(), secrets: () => secrets.env() });
  const folders = new Folders(cfg.workspace, cfg.hermesHome);
  const allowed = new Set(cfg.allowedOrigins);
  const sse = new Set<ServerResponse>();
  store.subscribe((e) => {
    const frame = `data: ${JSON.stringify(e)}\n\n`;
    for (const res of sse) res.write(frame);
  });

  const requireBoard = async (id: unknown): Promise<string> => {
    if (typeof id !== "string" || !BOARD_ID_RE.test(id) || !(await relay.exists(id))) throw new HttpError(404, `no board ${String(id)}`);
    return id;
  };

  const bundlesOf = async (boardId: string) => resolveGraph(await relay.graph(boardId));
  const modelsOf = (bundles: AgentBundle[]): ModelNode[] => [...new Map(bundles.flatMap((b) => b.models).map((m) => [m.id, m])).values()];

  /**
   * After a compile, a saved key and at start: fill every compiled agent's .env from the board
   * compiled into this root, and keep the gateway up while any agent has a chat app whose bot
   * token is saved (a bot must answer without a run in progress). Serialized; never throws.
   */
  let syncing: Promise<void> = Promise.resolve();
  const syncAgents = (): Promise<void> => (syncing = syncing.then(async () => {
    const manifest = await readManifest(cfg.hermesHome);
    if (!manifest || !BOARD_ID_RE.test(manifest.graphId) || !(await relay.exists(manifest.graphId))) return;
    const { bundles } = await bundlesOf(manifest.graphId);
    const saved = await secrets.env();
    let live = false;
    for (const b of bundles) {
      if (!manifest.profiles.includes(b.agent.data.name)) continue;
      await writeProfileKeys(join(cfg.hermesHome, "profiles", b.agent.data.name), resolveEntries(envEntriesFor(b), saved));
      live ||= hasLiveChannel(b, saved);
    }
    if (live) console.log(`[engine] chat apps: gateway ${await runner.ensureGateway()}`);
  }).catch((err: unknown) => console.error("[engine] could not update agents' keys:", err)));
  onBoardSaved = (boardId) => {
    void readManifest(cfg.hermesHome).then((m) => { if (m?.graphId === boardId) void syncAgents(); }).catch(() => undefined);
  };

  const routes: Record<string, (req: IncomingMessage, url: URL) => Promise<unknown>> = {
    "GET /api/health": async (): Promise<Health> => {
      const bin = await findHermes();
      return { ok: true, version: ENGINE_VERSION, workspace: cfg.workspace, hermesHome: cfg.hermesHome, managedRoot: cfg.managedRoot, hermes: { found: !!bin, path: bin?.path ?? null, kind: bin?.kind ?? null } };
    },

    "GET /api/boards": async (): Promise<BoardInfo[]> => relay.list(),
    /** "Report a problem": version, system, engine state and the log's last lines, keys hidden. */
    "GET /api/diagnostics": async (): Promise<Diagnostics> => {
      const [hermes, boards, saved, log] = await Promise.all([hermesInfo(), relay.list(), secrets.env(), cfg.logFile ? tail(cfg.logFile) : Promise.resolve(null)]);
      const text = diagnosticsText({ version: ENGINE_VERSION, os: osLine(), installed: hermes.installed, hermes, boards: boards.length, log, at: new Date() });
      return { text: redact(text, Object.values(saved)) };
    },

    // ---- the Hermes runtime ----
    "GET /api/hermes": async (): Promise<HermesInfo> => hermesInfo(),
    /** Prepare McBot's own Hermes (first launch): tools and dependencies, minutes, progress in GET /api/hermes. */
    "POST /api/hermes/prepare": async (): Promise<HermesInfo> => {
      const src = bundledSource();
      if (!src) throw new HttpError(404, "This McBot has no engine of its own");
      if (setupJob.state !== "running") {
        setupJob = { state: "running", lines: [] };
        const push = (line: string) => {
          setupJob.lines.push(line);
          if (setupJob.lines.length > 200) setupJob.lines.splice(0, setupJob.lines.length - 200);
        };
        void (async () => {
          const ok = await runHermesSetup(src, cfg.hermesHome, push);
          const bin = ok ? bundledHermes() : null;
          const ready = bin && (await prepareHermes(bin, cfg.hermesHome, push));
          setupJob.state = ready && ready.env?.PYTHONPATH ? "done" : "failed";
          push(setupJob.state === "done" ? "The engine is ready" : "The engine could not be prepared");
        })();
      }
      return hermesInfo();
    },
    /** Stop McBot's own gateway; the next run starts a fresh one (picks up new keys and MCP servers). */
    "POST /api/hermes/gateway/restart": async (): Promise<HermesInfo> => {
      const bin = await findHermes();
      if (!cfg.managedRoot) throw new HttpError(409, "This engine home is not McBot's own; restart its gateway yourself");
      if (bin) await stopGateway(bin, cfg.hermesHome);
      return hermesInfo();
    },

    // ---- setup assistant ----
    "GET /api/setup": async (): Promise<SetupState> => setup.get(),
    "GET /api/setup/detect": async (): Promise<SetupDetect> => {
      const [bin, local, names] = await Promise.all([findHermes(), detectLocal(), secrets.names()]);
      return { hermes: { found: !!bin, path: bin?.path ?? null, kind: bin?.kind ?? null, source: !!bundledSource() }, local, secrets: names };
    },
    "POST /api/setup/models": async (req) => {
      const body = parse(z.object({ baseUrl: z.string().url(), keyName: z.string().optional() }), await json(req));
      const key = body.keyName ? (await secrets.env())[body.keyName] : undefined;
      return { models: await listModels(body.baseUrl, key, 4000) };
    },
    /** The board the assistant built: fills the empty first-run board, else a new one. */
    "POST /api/setup/board": async (req): Promise<BoardInfo> => {
      const body = parse(z.object({ name: z.string().trim().min(1).max(80), graph: LooseGraph }), await json(req));
      const boards = await relay.list();
      const graph = { ...body.graph, name: body.name } as Graph;
      if (boards.length === 1 && (await relay.fillIfEmpty(boards[0]!.id, graph))) return { id: boards[0]!.id, name: body.name };
      const id = `${slugOf(body.name)}-${randomBytes(2).toString("hex")}`;
      await relay.create(id, body.name, graph);
      return { id, name: body.name };
    },
    "POST /api/setup/complete": async (req): Promise<SetupState> => {
      const profile = z.object({
        kind: z.enum(["personal", "team", "company"]), name: z.string().max(80), company: z.string().max(120), about: z.string().max(600), role: z.string().max(120),
      }).nullable();
      const body = parse(z.object({ profile }), await json(req));
      return setup.complete(body.profile);
    },
    "GET /api/secrets": async () => ({ names: await secrets.names() }),
    "POST /api/secrets": async (req) => {
      const body = parse(z.object({ name: z.string(), value: z.string() }), await json(req));
      try {
        await secrets.set(body.name, body.value);
      } catch (err) {
        if (err instanceof SecretError) throw new HttpError(400, err.message);
        throw err;
      }
      // A running gateway was started without this key.
      if (cfg.managedRoot) runner.markGatewayStale();
      void syncAgents();
      return { names: await secrets.names() };
    },
    "POST /api/boards": async (req) => {
      const { name } = parse(z.object({ name: z.string().trim().min(1).max(80) }), await json(req));
      const id = `${slugOf(name)}-${randomBytes(2).toString("hex")}`;
      await relay.create(id, name);
      return { id, name };
    },

    "GET /api/compile": async (_req, url): Promise<CompileResponse> => compileBoard(await requireBoard(url.searchParams.get("boardId")), true),
    "POST /api/compile": async (req): Promise<CompileResponse> => {
      const body = parse(z.object({ boardId: z.string(), dryRun: z.boolean().default(false) }), await json(req));
      return compileBoard(await requireBoard(body.boardId), body.dryRun);
    },

    "GET /api/runs": async (_req, url) => store.list(url.searchParams.get("boardId") ?? undefined),
    "POST /api/runs": async (req) => {
      const body = parse(z.object({ boardId: z.string(), agentNodeId: z.string(), prompt: z.string().trim().min(1).max(100_000) }), await json(req));
      const boardId = await requireBoard(body.boardId);
      const { bundles, issues } = await bundlesOf(boardId);
      const bundle = bundles.find((b) => b.agent.id === body.agentNodeId);
      if (!bundle) throw new HttpError(404, "no such agent on this board");
      const drift = await compileBoard(boardId, true);
      if (!drift.ok) throw new HttpError(409, "The board has errors; fix them before running.", { issues });
      const dir = `profiles/${bundle.agent.data.name}/`;
      const stale = drift.report.changes.filter((c) => c.path.startsWith(dir) && c.status !== "unchanged");
      if (stale.length) throw new HttpError(409, `The board changed since ${bundle.agent.data.name} was last compiled. Compile, then run.`, { stale: stale.map((c) => c.path) });
      if (!(await findHermes())) throw new HttpError(503, "The engine is not set up yet");
      const runId = await runner.start({
        boardId, agentNodeId: bundle.agent.id, profile: bundle.agent.data.name, prompt: body.prompt,
        toolNodes: bundle.tools.map((t) => ({ id: t.id, name: t.data.name })), models: bundle.models,
        env: envEntriesFor(bundle),
      });
      return { runId };
    },

    "GET /api/memory": async (_req, url): Promise<AgentMemoryView[]> => {
      const boardId = await requireBoard(url.searchParams.get("boardId"));
      const { bundles } = await bundlesOf(boardId);
      const manifest = await readManifest(cfg.hermesHome);
      return Promise.all(bundles.map(async ({ agent }) => ({
        profile: agent.data.name,
        nodeId: agent.id,
        displayName: agent.data.displayName || agent.data.name,
        compiled: !!manifest?.profiles.includes(agent.data.name),
        busy: runner.isBusy(agent.data.name),
        memory: await readMemory(cfg.hermesHome, agent.data.name, "memory"),
        user: await readMemory(cfg.hermesHome, agent.data.name, "user"),
      })));
    },
    "PUT /api/memory": async (req) => {
      const body = parse(z.object({
        profile: z.string(), target: z.enum(["memory", "user"]), entries: z.array(z.string().max(5000)).max(500), baseSha256: z.string().nullable(),
      }), await json(req));
      const manifest = await readManifest(cfg.hermesHome);
      if (!manifest?.profiles.includes(body.profile)) throw new HttpError(404, `profile ${body.profile} is not compiled by McBot`);
      if (runner.isBusy(body.profile)) throw new HttpError(409, `${body.profile} is running; edit its memory when the run finishes`);
      try {
        return await writeMemory(cfg.hermesHome, body.profile, body.target, body.entries, body.baseSha256);
      } catch (err) {
        if (err instanceof MemoryConflict) throw new HttpError(409, err.message);
        throw err;
      }
    },

    "GET /api/cost": async (_req, url) => {
      const boardId = await requireBoard(url.searchParams.get("boardId"));
      const { bundles } = await bundlesOf(boardId);
      const manifest = await readManifest(cfg.hermesHome);
      const profiles = bundles
        .filter((b) => manifest?.profiles.includes(b.agent.data.name))
        .map((b) => ({ profile: b.agent.data.name, agentNodeId: b.agent.id, sessions: readSessions(cfg.hermesHome, b.agent.data.name) }));
      return buildCostReport(profiles, await store.list(boardId), modelsOf(bundles));
    },

    "GET /api/fs/roots": async (_req, url): Promise<FsRoot[]> => {
      const boardId = await requireBoard(url.searchParams.get("boardId"));
      const { bundles } = await bundlesOf(boardId);
      const manifest = await readManifest(cfg.hermesHome);
      const profiles: FsRoot[] = bundles
        .filter((b) => manifest?.profiles.includes(b.agent.data.name))
        .map((b) => ({ id: `profile:${b.agent.data.name}`, kind: "profile", name: b.agent.data.displayName || b.agent.data.name, path: join(cfg.hermesHome, "profiles", b.agent.data.name), nodeId: b.agent.id }));
      const shared: FsRoot = { id: "workspace:files", kind: "workspace", name: "Shared files", path: join(cfg.workspace, "files") };
      return [...profiles, shared, ...(await folders.opened())];
    },
    "POST /api/fs/roots": async (req): Promise<FsRoot> => {
      const { path } = parse(z.object({ path: z.string().trim().min(1) }), await json(req));
      return folders.open(path);
    },
    "POST /api/fs/roots/close": async (req) => {
      const { id } = parse(z.object({ id: z.string().startsWith("folder:") }), await json(req));
      await folders.close(id);
      return { ok: true };
    },
    "GET /api/fs/list": async (_req, url): Promise<FsListing> => {
      const rootId = url.searchParams.get("root") ?? "";
      const rel = url.searchParams.get("path") ?? "";
      const manifest = await readManifest(cfg.hermesHome);
      const dir = await folders.resolveRoot(rootId, manifest?.profiles ?? []);
      const owned = new Set(manifest?.files.map((f) => f.path) ?? []);
      const profile = rootId.startsWith("profile:") ? `profiles/${rootId.slice(8)}/` : null;
      const { entries, truncated } = await folders.list(dir, rel, (p) => !!profile && owned.has(profile + p));
      return { root: rootId, path: rel, entries, truncated };
    },
    "GET /api/fs/read": async (_req, url): Promise<FsPreview> => {
      const manifest = await readManifest(cfg.hermesHome);
      const dir = await folders.resolveRoot(url.searchParams.get("root") ?? "", manifest?.profiles ?? []);
      return folders.read(dir, url.searchParams.get("path") ?? "");
    },
  };

  async function hermesInfo(): Promise<HermesInfo> {
    const bin = await findHermes();
    const src = bundledSource();
    return {
      kind: bin?.kind ?? null,
      path: bin?.kind === "bundled" ? src?.dir ?? null : bin?.path ?? null,
      upstream: src ? await bundledUpstream() : null,
      root: cfg.hermesHome,
      managedRoot: cfg.managedRoot,
      gateway: await gatewayStatus(cfg.hermesHome),
      source: !!src,
      installed: !!process.env.MCBOT_HERMES_BUNDLE,
      setup: { state: setupJob.state, lines: setupJob.lines.slice(-30) },
    };
  }

  async function compileBoard(boardId: string, dryRun: boolean): Promise<CompileResponse> {
    const graph = await relay.graph(boardId);
    const { issues } = resolveGraph(graph);
    if (issues.some((i) => i.level === "error")) return { ok: false, issues, error: "The board has errors" };
    try {
      const report = await writeCompileResult(compile(graph), cfg.hermesHome, { dryRun });
      const configChanged = report.changes.some((c) => c.path.endsWith("/config.yaml") && c.status !== "unchanged");
      if (!dryRun && configChanged) runner.markGatewayStale();
      if (!dryRun) await atomicWrite(join(cfg.workspace, "compiles", `${boardId}.json`), `${JSON.stringify({ at: Date.now(), report }, null, 2)}\n`);
      if (!dryRun) void syncAgents();
      return { ok: true, report, issues, gateway: !dryRun && configChanged && cfg.managedRoot ? "restart-pending" : "unchanged" };
    } catch (err) {
      if (err instanceof OwnershipError) return { ok: false, issues, error: err.message };
      throw err;
    }
  }

  const cors = (req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin;
    if (origin && allowed.has(origin)) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "origin");
      res.setHeader("access-control-allow-headers", "content-type");
      res.setHeader("access-control-allow-methods", "GET, POST, PUT, OPTIONS");
    }
  };
  const refusedSeen = new Set<string>();
  const permitted = (req: IncomingMessage) => {
    const ok = LOOPBACK_HOST.test(req.headers.host ?? "") && (!req.headers.origin || allowed.has(req.headers.origin));
    const key = `${req.headers.origin ?? "-"} ${req.headers.host ?? "-"}`;
    if (!ok && !refusedSeen.has(key)) {
      // Once per origin/host pair, so a refused page names what it would take to allow it.
      refusedSeen.add(key);
      console.warn(`[engine] refused origin ${JSON.stringify(req.headers.origin ?? null)} host ${JSON.stringify(req.headers.host ?? null)} (allow an origin with MCBOT_ALLOWED_ORIGINS)`);
    }
    return ok;
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    cors(req, res);
    if (!permitted(req)) {
      res.writeHead(403, { "content-type": "application/json" }).end(JSON.stringify({ error: "origin or host not allowed" }));
      return;
    }
    if (req.method === "OPTIONS") return void res.writeHead(204).end();

    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(": connected\n\n");
      sse.add(res);
      const keep = setInterval(() => res.write(": ping\n\n"), 15_000);
      req.on("close", () => {
        clearInterval(keep);
        sse.delete(res);
      });
      return;
    }
    // An image or video an agent made, streamed as itself (the chat shows it from a blob URL).
    if (req.method === "GET" && url.pathname === "/api/media") {
      try {
        const profile = url.searchParams.get("profile") ?? "";
        const manifest = await readManifest(cfg.hermesHome);
        if (!manifest?.profiles.includes(profile)) throw new MediaError(404, `no compiled agent ${profile}`);
        const file = await mediaFile(join(cfg.hermesHome, "profiles", profile), url.searchParams.get("path") ?? "");
        res.writeHead(200, { "content-type": file.type, "content-length": file.size, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" });
        createReadStream(file.abs).pipe(res);
      } catch (err) {
        const status = err instanceof MediaError ? err.status : 500;
        res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ error: (err as Error).message }));
      }
      return;
    }
    const runMatch = /^\/api\/runs\/(run_[a-z0-9]+_[a-f0-9]+)(\/cancel)?$/.exec(url.pathname);
    try {
      let body: unknown;
      if (runMatch && req.method === "GET" && !runMatch[2]) body = await store.events(runMatch[1]!);
      else if (runMatch && req.method === "POST" && runMatch[2]) body = { cancelled: runner.cancel(runMatch[1]!) };
      else {
        const handler = routes[`${req.method} ${url.pathname}`];
        if (!handler) throw new HttpError(404, `no route ${req.method} ${url.pathname}`);
        body = await handler(req, url);
      }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    } catch (err) {
      const status = err instanceof HttpError || err instanceof FolderError ? err.status : 500;
      if (status === 500) console.error("[engine]", err);
      const extra = err instanceof HttpError && err.body && typeof err.body === "object" ? err.body : {};
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ error: (err as Error).message, ...extra }));
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const m = /^\/board\/([a-z0-9][a-z0-9-]{0,63})$/.exec(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
    if (!m || !permitted(req)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      relay.connect(ws, m[1]!).catch((err) => {
        console.error("[relay]", err);
        ws.close(1011, "board unavailable");
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) =>
      reject(err.code === "EADDRINUSE" ? new Error(`port ${cfg.port} is in use — is another McBot engine running? Set MCBOT_PORT to use another port.`) : err));
    server.listen(cfg.port, cfg.host, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  void syncAgents();
  return {
    server,
    url: `http://${cfg.host}:${port}`,
    relay,
    runner,
    store,
    close: async () => {
      for (const res of sse) res.end();
      for (const c of wss.clients) c.terminate();
      await relay.flush();
      await store.flush();
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await closed;
    },
  };
}
