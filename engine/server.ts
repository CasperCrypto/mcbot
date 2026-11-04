/**
 * The McBot engine: one local process that is the board relay (M2), the
 * compile writer (M1), the run launcher (M3) and the reader of Hermes data
 * (M4). Loopback only. No auth in v0, so every request must come from an
 * allowed Origin and a loopback Host: a web page in the user's browser must
 * not be able to compile or launch agents (cross-site request / DNS rebinding).
 */
import { randomBytes } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { z } from "zod";
import { compile, resolveGraph, type AgentBundle } from "../src/compile";
import { MANIFEST_PATH } from "../src/contracts/compile";
import type { AgentMemoryView, BoardInfo, CompileResponse, FileEntry, Health } from "../src/contracts/api";
import type { ModelNode } from "../src/contracts/graph";
import { buildCostReport } from "./cost";
import { atomicWrite, readTextOrNull, resolveInside, toPosix } from "./fsutil";
import { findHermes } from "./hermes";
import { MemoryConflict, readMemory, readSessions, writeMemory } from "./hermesData";
import { BOARD_ID_RE, BoardRelay } from "./relay";
import { Runner } from "./runner";
import { RunStore } from "./runStore";
import { OwnershipError, readManifest, writeCompileResult } from "./writer";

export const ENGINE_VERSION = "0.1.0";

export interface EngineConfig {
  workspace: string;
  hermesHome: string;
  managedRoot: boolean;
  port: number;
  host: string;
  allowedOrigins: string[];
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

const SKIP_DIRS = new Set(["node_modules", ".npm", ".cache", "cache", "audio_cache", "image_cache", "backups", "runtime", "plugin-update-checks"]);

async function walk(root: string, rel: string, owned: Set<string>, out: FileEntry[], depth = 0): Promise<void> {
  if (out.length > 3000 || depth > 6) return;
  let entries;
  try {
    entries = await readdir(resolveInside(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const p = `${rel}/${e.name}`;
    if (e.isDirectory()) {
      out.push({ path: p, kind: "dir", bytes: 0, owner: "hermes" });
      if (!SKIP_DIRS.has(e.name) && !(depth === 0 && e.name === "home")) await walk(root, p, owned, out, depth + 1);
    } else if (e.isFile()) {
      const s = await stat(resolveInside(root, p));
      out.push({ path: p, kind: "file", bytes: s.size, owner: owned.has(p) ? "mcbot" : "hermes" });
    }
  }
}

export interface Engine {
  server: Server;
  url: string;
  relay: BoardRelay;
  runner: Runner;
  store: RunStore;
  close(): Promise<void>;
}

export async function startEngine(cfg: EngineConfig): Promise<Engine> {
  const relay = new BoardRelay(join(cfg.workspace, "boards"));
  const store = new RunStore(join(cfg.workspace, "runs"));
  const runner = new Runner({ store, root: cfg.hermesHome, managedRoot: cfg.managedRoot, findHermes: () => findHermes() });
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

  const routes: Record<string, (req: IncomingMessage, url: URL) => Promise<unknown>> = {
    "GET /api/health": async (): Promise<Health> => {
      const bin = await findHermes();
      return { ok: true, version: ENGINE_VERSION, workspace: cfg.workspace, hermesHome: cfg.hermesHome, managedRoot: cfg.managedRoot, hermes: { found: !!bin, path: bin?.path ?? null } };
    },

    "GET /api/boards": async (): Promise<BoardInfo[]> => relay.list(),
    "POST /api/boards": async (req) => {
      const { name } = parse(z.object({ name: z.string().trim().min(1).max(80) }), await json(req));
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "board";
      const id = `${slug}-${randomBytes(2).toString("hex")}`;
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
      if (!(await findHermes())) throw new HttpError(503, "Hermes not found: install it or set MCBOT_HERMES_BIN");
      const runId = await runner.start({
        boardId, agentNodeId: bundle.agent.id, profile: bundle.agent.data.name, prompt: body.prompt,
        toolNodes: bundle.tools.map((t) => ({ id: t.id, name: t.data.name })), models: bundle.models,
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

    "GET /api/files": async (_req, url) => {
      const boardId = await requireBoard(url.searchParams.get("boardId"));
      const { bundles } = await bundlesOf(boardId);
      const manifest = await readManifest(cfg.hermesHome);
      const owned = new Set([...(manifest?.files.map((f) => f.path) ?? []), MANIFEST_PATH]);
      const out: { profile: string; nodeId: string; files: FileEntry[] }[] = [];
      for (const b of bundles) {
        const files: FileEntry[] = [];
        if (manifest?.profiles.includes(b.agent.data.name)) await walk(cfg.hermesHome, `profiles/${b.agent.data.name}`, owned, files);
        out.push({ profile: b.agent.data.name, nodeId: b.agent.id, files });
      }
      return out;
    },
    "GET /api/file": async (_req, url) => {
      const rel = url.searchParams.get("path") ?? "";
      if (!rel.startsWith("profiles/") && rel !== MANIFEST_PATH) throw new HttpError(400, "only files under profiles/ can be read");
      const abs = resolveInside(cfg.hermesHome, rel);
      const s = await stat(abs).catch(() => null);
      if (!s?.isFile()) throw new HttpError(404, "no such file");
      if (s.size > 512_000) return { path: rel, bytes: s.size, text: null, reason: "too large to preview" };
      const text = (await readTextOrNull(abs)) ?? "";
      return /\u0000/.test(text) ? { path: rel, bytes: s.size, text: null, reason: "binary file" } : { path: rel, bytes: s.size, text };
    },
  };

  async function compileBoard(boardId: string, dryRun: boolean): Promise<CompileResponse> {
    const graph = await relay.graph(boardId);
    const { issues } = resolveGraph(graph);
    if (issues.some((i) => i.level === "error")) return { ok: false, issues, error: "The board has errors" };
    try {
      const report = await writeCompileResult(compile(graph), cfg.hermesHome, { dryRun });
      const configChanged = report.changes.some((c) => c.path.endsWith("/config.yaml") && c.status !== "unchanged");
      if (!dryRun && configChanged) runner.markGatewayStale();
      if (!dryRun) await atomicWrite(join(cfg.workspace, "compiles", `${boardId}.json`), `${JSON.stringify({ at: Date.now(), report }, null, 2)}\n`);
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
  const permitted = (req: IncomingMessage) =>
    LOOPBACK_HOST.test(req.headers.host ?? "") && (!req.headers.origin || allowed.has(req.headers.origin));

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
      const status = err instanceof HttpError ? err.status : 500;
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
