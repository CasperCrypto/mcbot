import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { addNode, graphFromDoc } from "../src/board/ydoc";
import { newCode } from "./sharing";
import { startEngine, type Engine } from "./server";

const ORIGIN = "tauri://localhost";
const SHARE_PORT = 47_000 + Math.floor(Math.random() * 2000);
const net = `http://127.0.0.1:${SHARE_PORT}`;
let engine: Engine;

beforeAll(async () => {
  const workspace = mkdtempSync(join(tmpdir(), "mcbot-share-"));
  engine = await startEngine({ workspace, hermesHome: join(workspace, "hermes"), managedRoot: true, port: 0, host: "127.0.0.1", allowedOrigins: [ORIGIN], sharePort: SHARE_PORT });
  await engine.relay.create("team", "Team");
});
afterAll(() => engine?.close());

const host = async <T>(path: string, body?: unknown) => {
  const res = await fetch(`${engine.url}${path}`, { method: body === undefined ? "GET" : "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return (await res.json()) as T;
};
const remote = (path: string, init: { method?: string; key?: string; body?: unknown; origin?: string | null } = {}) =>
  fetch(`${net}${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: { ...(init.origin === null ? {} : { origin: init.origin ?? ORIGIN }), "content-type": "application/json", ...(init.key ? { authorization: `Bearer ${init.key}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

describe("share on your network", () => {
  it("is closed until the person turns it on", async () => {
    await expect(fetch(`${net}/api/health`, { headers: { origin: ORIGIN } })).rejects.toThrow();
    expect(newCode()).toMatch(/^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/);
  });

  let key = "";
  it("lets a teammate join once with the invite code, and only from McBot", async () => {
    const view = await host<{ on: boolean; invite: { code: string } | null }>("/api/share", { on: true });
    expect(view.on).toBe(true);
    const code = view.invite!.code;
    expect((await remote("/api/health", { origin: null })).status).toBe(403);
    expect((await remote("/api/health")).status).toBe(401);
    expect((await remote("/api/join", { body: { code: "AAA-AAA", name: "Sam" } })).status).toBe(403);
    const joined = await remote("/api/join", { body: { code: code.toLowerCase(), name: "Sam" } });
    expect(joined.status).toBe(200);
    key = ((await joined.json()) as { key: string }).key;
    expect(key).toMatch(/^mcb_/);
    expect((await remote("/api/join", { body: { code, name: "Eve" } })).status).toBe(403);
    expect((await host<{ members: { name: string }[] }>("/api/share")).members.map((m) => m.name)).toEqual(["Sam"]);
  });

  it("gives a member the boards, never this computer's keys, files or sharing", async () => {
    expect((await remote("/api/boards", { key })).status).toBe(200);
    expect((await remote("/api/fs/roots?boardId=team", { key })).status).toBe(403);
    expect((await remote("/api/secrets", { key, body: { name: "X", value: "y" } })).status).toBe(403);
    expect((await remote("/api/share", { key })).status).toBe(403);
    expect((await remote("/api/diagnostics", { key })).status).toBe(403);
    expect((await remote("/api/boards", { key: "mcb_wrong" })).status).toBe(401);
  });

  it("puts the member on the live board with the host", async () => {
    const connect = (url: string, params: Record<string, string>) => {
      const doc = new Y.Doc();
      const provider = new WebsocketProvider(url, "team", doc, {
        disableBc: true, params,
        WebSocketPolyfill: class extends WebSocket {
          constructor(u: string | URL, p?: string | string[]) {
            super(u, p, { headers: { origin: ORIGIN } });
          }
        } as unknown as typeof globalThis.WebSocket,
      });
      return { doc, provider };
    };
    const a = connect(`${engine.url.replace("http", "ws")}/board`, {});
    const b = connect(`ws://127.0.0.1:${SHARE_PORT}/board`, { key });
    const until = async (cond: () => boolean) => { for (const end = Date.now() + 5000; !cond(); ) { if (Date.now() > end) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 20)); } };
    await until(() => a.provider.synced && b.provider.synced);
    addNode(b.doc, { id: "n1", kind: "agent", position: { x: 0, y: 0 }, data: { name: "sam-bot", displayName: "", description: "", soul: "", skills: [], capabilities: null } });
    await until(() => graphFromDoc(a.doc).nodes.some((n) => n.id === "n1"));
    a.provider.destroy();
    b.provider.destroy();
    const stranger = connect(`ws://127.0.0.1:${SHARE_PORT}/board`, {});
    await new Promise((r) => setTimeout(r, 300));
    expect(stranger.provider.synced).toBe(false);
    stranger.provider.destroy();
  });

  it("closes the network port when the person stops sharing", async () => {
    await host("/api/share", { on: false });
    await expect(fetch(`${net}/api/health`, { headers: { origin: ORIGIN } })).rejects.toThrow();
  });
});
