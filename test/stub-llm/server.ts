/**
 * A deterministic OpenAI-compatible chat completions server for tests and
 * offline demos. It stands in for "one local OpenAI-compatible endpoint" so
 * the real Hermes runtime can be exercised end to end without a GPU or a key.
 *
 * Behaviour, keyed on the last user message:
 *   "remember: <fact>"          → calls Hermes' `memory` tool (add to MEMORY.md),
 *                                  then answers "Saved to memory: <fact>"
 *   "call:<tool> {json}"        → calls <tool> with those arguments if the request
 *                                  offers it, then answers with the tool's result
 *   "what is 2+2" / "2+2"       → "4"
 *   anything else               → "Stub model here. You asked: <message>"
 * Requests without `tools` (Hermes' title generation, compression) always get text.
 *
 * POST /images/generations answers like OpenAI's Images API with a 1×1 PNG, so
 * Hermes' image maker (provider openai, OPENAI_BASE_URL → here) runs offline.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

interface Msg {
  role: string;
  content?: unknown;
  tool_calls?: unknown[];
}
export interface ChatRequest {
  model?: string;
  messages?: Msg[];
  stream?: boolean;
  tools?: { function?: { name?: string } }[];
  stream_options?: { include_usage?: boolean };
}
type Reply = { kind: "text"; text: string } | { kind: "tool"; name: string; args: string };

/** A 1×1 PNG. */
export const STUB_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export interface StubLlm {
  url: string;
  port: number;
  requests: ChatRequest[];
  /** Bodies of POST /images/generations. */
  imageRequests: Record<string, unknown>[];
  /** The Authorization header of each chat request, in order ("" when none). */
  authorizations: string[];
  close(): Promise<void>;
}

function text(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === "object" && p && "text" in p ? String((p as { text: unknown }).text) : "")).join("");
  return "";
}

const tokens = (s: string) => Math.max(1, Math.ceil(s.length / 4));

export function decide(req: ChatRequest): Reply {
  const msgs = req.messages ?? [];
  const last = msgs[msgs.length - 1];
  const offered = new Set((req.tools ?? []).map((t) => t.function?.name).filter(Boolean));
  if (last?.role === "tool") {
    const lastUser = [...msgs].reverse().find((m) => m.role === "user");
    const fact = /remember:\s*(.+)/is.exec(text(lastUser?.content))?.[1]?.trim();
    return { kind: "text", text: fact ? `Saved to memory: ${fact}` : `Tool result: ${text(last.content).slice(0, 400)}` };
  }
  const q = text([...msgs].reverse().find((m) => m.role === "user")?.content).trim();
  const remember = /remember:\s*(.+)/is.exec(q)?.[1]?.trim();
  if (remember && offered.has("memory")) {
    return { kind: "tool", name: "memory", args: JSON.stringify({ action: "add", target: "memory", content: remember }) };
  }
  const call = /call:([A-Za-z0-9_.-]+)\s*(\{.*\})?/s.exec(q);
  if (call && offered.has(call[1]!)) return { kind: "tool", name: call[1]!, args: call[2] ?? "{}" };
  // Hermes defers MCP tools behind its `tool_call` bridge (tools/tool_labels.py labels_for_call).
  if (call && offered.has("tool_call")) {
    return { kind: "tool", name: "tool_call", args: JSON.stringify({ name: call[1], arguments: JSON.parse(call[2] ?? "{}") }) };
  }
  if (/\b2\s*\+\s*2\b/.test(q)) return { kind: "text", text: "4" };
  return { kind: "text", text: `Stub model here. You asked: ${q.slice(0, 200)}` };
}

function usage(req: ChatRequest, reply: Reply) {
  const prompt = tokens(JSON.stringify(req.messages ?? []));
  const completion = tokens(reply.kind === "text" ? reply.text : reply.args);
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function respond(res: ServerResponse, body: ChatRequest, n: number) {
  const reply = decide(body);
  const id = `chatcmpl-stub-${n}`;
  const model = body.model ?? "stub";
  const created = 1_700_000_000;
  const toolCall = reply.kind === "tool" ? { id: `call_${n}`, type: "function", function: { name: reply.name, arguments: reply.args } } : null;
  const finish = reply.kind === "tool" ? "tool_calls" : "stop";

  if (!body.stream) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id, object: "chat.completion", created, model,
      choices: [{ index: 0, finish_reason: finish, message: reply.kind === "text" ? { role: "assistant", content: reply.text } : { role: "assistant", content: null, tool_calls: [toolCall] } }],
      usage: usage(body, reply),
    }));
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const send = (choices: unknown[], extra: object = {}) =>
    res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices, ...extra })}\n\n`);
  send([{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }]);
  if (reply.kind === "text") {
    for (const piece of reply.text.match(/.{1,12}/gs) ?? [""]) send([{ index: 0, delta: { content: piece }, finish_reason: null }]);
  } else {
    send([{ index: 0, delta: { tool_calls: [{ index: 0, ...toolCall }] }, finish_reason: null }]);
  }
  send([{ index: 0, delta: {}, finish_reason: finish }]);
  if (body.stream_options?.include_usage) send([], { usage: usage(body, reply) });
  res.write("data: [DONE]\n\n");
  res.end();
}

export async function startStubLlm(port = 0, host = "127.0.0.1", onRequest?: (req: ChatRequest) => void): Promise<StubLlm> {
  const requests: ChatRequest[] = [];
  const imageRequests: Record<string, unknown>[] = [];
  const authorizations: string[] = [];
  const server: Server = createServer(async (req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (req.method === "GET" && path?.endsWith("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "stub-model", object: "model", owned_by: "mcbot" }] }));
      return;
    }
    if (req.method === "POST" && path?.endsWith("/chat/completions")) {
      const body = JSON.parse((await readBody(req)) || "{}") as ChatRequest;
      requests.push(body);
      authorizations.push(String(req.headers.authorization ?? ""));
      onRequest?.(body);
      respond(res, body, requests.length);
      return;
    }
    if (req.method === "POST" && path?.endsWith("/images/generations")) {
      imageRequests.push(JSON.parse((await readBody(req)) || "{}") as Record<string, unknown>);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ created: 1_700_000_000, data: [{ b64_json: STUB_PNG_B64 }] }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: `stub-llm: no route ${req.method} ${path}` } }));
  });
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const actual = (server.address() as AddressInfo).port;
  return {
    url: `http://${host}:${actual}/v1`,
    port: actual,
    requests,
    imageRequests,
    authorizations,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
