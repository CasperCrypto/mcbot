/**
 * Runs through Hermes' own runs API (the gateway's API server), for McBot's own Hermes. Unlike a
 * one-shot `hermes chat`, a run there can stop and ask the person (approval.request) and be
 * answered, which is what approval cards are. Every key and shape is verified in docs/HERMES.md
 * ("Runs over Hermes' API server").
 *
 *   gateway env  API_SERVER_KEY / API_SERVER_PORT / API_SERVER_HOST   (root and each profile .env)
 *   start        POST  /p/<profile>/v1/runs            {"input": prompt}     → {run_id}
 *   events       GET   /p/<profile>/v1/runs/<id>/events (SSE: data: {"event", ...})
 *   answer       POST  /p/<profile>/v1/runs/<id>/approval {request_id, execution_generation, choice}
 *   stop         POST  /p/<profile>/v1/runs/<id>/stop
 *   status       GET   /p/<profile>/v1/runs/<id>                               → {session_id, ...}
 */
import { randomBytes } from "node:crypto";
import { chmod } from "node:fs/promises";
import { createServer } from "node:net";
import type { RunEventInput, Tokens } from "../src/contracts/run";
import { atomicWrite, readTextOrNull } from "./fsutil";
import { StreamMapper, type ToolNodeRef } from "./streamJson";

export interface GatewayApi {
  key: string;
  port: number;
}

/** A port nobody listens on right now, from the system (loopback). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const a = srv.address();
      srv.close(() => (a && typeof a === "object" ? resolve(a.port) : reject(new Error("no free port"))));
    });
  });
}

/** The workspace's gateway API key and port (<workspace>/gateway.json, owner-only), made once. The port
 * is picked free when the file is made (MCBOT_GATEWAY_PORT overrides), so two workspaces never clash. */
export async function gatewayApi(file: string, fixedPort = Number(process.env.MCBOT_GATEWAY_PORT) || 0): Promise<GatewayApi> {
  try {
    const saved = JSON.parse((await readTextOrNull(file)) ?? "null") as Partial<GatewayApi> | null;
    if (saved?.key && saved.key.length >= 32 && saved.port) return { key: saved.key, port: saved.port };
  } catch {
    /* made fresh below */
  }
  const made = { key: randomBytes(24).toString("hex"), port: fixedPort || (await freePort()) };
  await atomicWrite(file, `${JSON.stringify(made, null, 2)}\n`);
  await chmod(file, 0o600).catch(() => undefined);
  return made;
}

/** The lines that turn the gateway's API server on, for the root's and every profile's .env. */
export function apiEnv(g: GatewayApi): Record<string, string> {
  return { API_SERVER_KEY: g.key, API_SERVER_PORT: String(g.port), API_SERVER_HOST: "127.0.0.1" };
}

export class HermesRuns {
  constructor(private readonly g: GatewayApi) {}

  private url(profile: string, path: string): string {
    return `http://127.0.0.1:${this.g.port}/p/${encodeURIComponent(profile)}${path}`;
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.g.key}`, "content-type": "application/json" };
  }

  /** Is the API server answering (the gateway started with it)? */
  async up(timeoutMs = 1500): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${this.g.port}/health`, { signal: AbortSignal.timeout(timeoutMs) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async start(profile: string, prompt: string): Promise<string> {
    const res = await fetch(this.url(profile, "/v1/runs"), { method: "POST", headers: this.headers(), body: JSON.stringify({ input: prompt }) });
    const body = (await res.json().catch(() => ({}))) as { run_id?: string; error?: { message?: string } };
    if (!res.ok || !body.run_id) throw new Error(body.error?.message ?? `Hermes refused the run (${res.status})`);
    return body.run_id;
  }

  /** Every event of the run, until it ends or `signal` aborts. */
  async *events(profile: string, runId: string, signal?: AbortSignal): AsyncGenerator<Record<string, unknown>> {
    const res = await fetch(this.url(profile, `/v1/runs/${runId}/events`), { headers: this.headers(), signal });
    if (!res.ok || !res.body) throw new Error(`Hermes' event stream answered ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += dec.decode(value, { stream: true });
      for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
        if (!data) continue;
        try {
          yield JSON.parse(data) as Record<string, unknown>;
        } catch {
          /* a malformed frame is skipped */
        }
      }
    }
  }

  async answer(profile: string, runId: string, promptId: string, generation: number, choice: string): Promise<void> {
    const res = await fetch(this.url(profile, `/v1/runs/${runId}/approval`), {
      method: "POST", headers: this.headers(), body: JSON.stringify({ request_id: promptId, execution_generation: generation, choice }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string } };
      throw new Error(body.error?.message ?? `Hermes refused the answer (${res.status})`);
    }
  }

  async stop(profile: string, runId: string): Promise<void> {
    await fetch(this.url(profile, `/v1/runs/${runId}/stop`), { method: "POST", headers: this.headers(), body: "{}" }).catch(() => undefined);
  }

  async sessionOf(profile: string, runId: string): Promise<string | null> {
    try {
      const res = await fetch(this.url(profile, `/v1/runs/${runId}`), { headers: this.headers() });
      const body = (await res.json()) as { session_id?: unknown };
      return typeof body.session_id === "string" ? body.session_id : null;
    } catch {
      return null;
    }
  }
}

const TERMINAL = new Set(["run.completed", "run.failed", "run.cancelled", "run.interrupted"]);
export const isTerminal = (e: Record<string, unknown>) => TERMINAL.has(String(e.event));

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Hermes run events → McBot run events (contract 3). Unknown events are left out. */
export class RunsApiMapper {
  private readonly tools: StreamMapper;
  private readonly started = new Map<string, { tool: string; toolNodeId: string | null; at: number }>();
  private text = "";

  constructor(toolNodes: readonly ToolNodeRef[]) {
    this.tools = new StreamMapper(toolNodes);
  }

  map(e: Record<string, unknown>, startedAt: number): RunEventInput[] {
    switch (e.event) {
      case "tool.started": {
        const tool = str(e.tool);
        const toolNodeId = this.tools.toolNodeFor(tool);
        this.started.set(str(e.tool_call_id) || tool, { tool, toolNodeId, at: Date.now() });
        return [{ type: "run.tool.started", tool, input: e.preview === undefined ? undefined : { preview: e.preview }, toolNodeId }];
      }
      case "tool.completed": {
        const key = str(e.tool_call_id) || str(e.tool);
        const s = this.started.get(key);
        this.started.delete(key);
        const tool = s?.tool ?? str(e.tool);
        return [{ type: "run.tool.finished", tool, output: str(e.preview), durationMs: typeof e.duration === "number" && e.duration > 0 ? Math.round(e.duration * 1000) : s ? Date.now() - s.at : 0, isError: e.error === true, toolNodeId: s?.toolNodeId ?? this.tools.toolNodeFor(tool) }];
      }
      case "message.delta":
        this.text += str(e.delta);
        return [{ type: "run.text", text: str(e.delta) }];
      case "approval.request":
        return [{
          type: "run.approval", promptId: str(e.prompt_id), generation: num(e.execution_generation),
          command: str(e.command), description: str(e.description), choices: Array.isArray(e.choices) ? e.choices.map(String) : ["once", "deny"],
        }];
      case "approval.settled":
        return [{ type: "run.approval.settled", promptId: str(e.prompt_id), choice: typeof e.choice === "string" ? e.choice : null }];
      case "run.completed":
      case "run.failed":
      case "run.cancelled":
      case "run.interrupted": {
        const u = (e.usage ?? {}) as Record<string, unknown>;
        const tokens: Tokens | null = e.usage ? { input: num(u.input_tokens), output: num(u.output_tokens), total: num(u.total_tokens), cacheRead: 0, cacheWrite: 0 } : null;
        const status = e.event === "run.completed" ? "succeeded" : e.event === "run.failed" ? "failed" : "interrupted";
        const error = status === "failed" ? str(e.error) || "The run failed" : status === "interrupted" ? "Stopped" : null;
        return [{ type: "run.finished", status, exitCode: status === "succeeded" ? 0 : status === "failed" ? 1 : 130, text: str(e.output) || this.text, tokens, durationMs: Date.now() - startedAt, sessionId: null, error }];
      }
      default:
        return [];
    }
  }
}
