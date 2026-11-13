import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { addNode, graphFromDoc } from "../src/board/ydoc";
import { newCode } from "./sharing";
import { parseInvite } from "../src/app/lib/remote";
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
  it("lets teammates join with the invite link, only from McBot, until a new link replaces it", async () => {
    const view = await host<{ on: boolean; invite: { code: string; expiresAt: number } | null; link: string | null; addresses: string[] }>("/api/share", { on: true });
    expect(view.on).toBe(true);
    const code = view.invite!.code;
    expect(view.invite!.expiresAt - Date.now()).toBeGreaterThan(23 * 3600_000);
    if (view.addresses[0]) expect(view.link).toBe(`http://${view.addresses[0]}/join?code=${code}`);
    // Opened in a web browser, the link is a page that says how to join (no Origin, no data).
    const page = await remote(`/join?code=${code}`, { origin: null });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).not.toContain(code);
    expect((await remote("/api/health", { origin: null })).status).toBe(403);
    expect((await remote("/api/health")).status).toBe(401);
    expect((await remote("/api/join", { body: { code: "AAA-AAA", name: "Sam" } })).status).toBe(403);
    const joined = await remote("/api/join", { body: { code: code.toLowerCase(), name: "Sam" } });
    expect(joined.status).toBe(200);
    key = ((await joined.json()) as { key: string }).key;
    expect(key).toMatch(/^mcb_/);
    expect((await remote("/api/join", { body: { code, name: "Ana" } })).status).toBe(200);
    await host("/api/share/invite", {});
    expect((await remote("/api/join", { body: { code, name: "Eve" } })).status).toBe(403);
    expect((await host<{ members: { name: string }[] }>("/api/share")).members.map((m) => m.name)).toEqual(["Sam", "Ana"]);
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

  it("reads an invite pasted as a link or as address and code", () => {
    expect(parseInvite("Join my boards: http://192.168.1.20:4318/join?code=K7Q-4XM")).toEqual({ address: "192.168.1.20:4318", code: "K7Q-4XM" });
    expect(parseInvite("Address: 10.0.0.5:4318\nCode: k7q-4xm")).toEqual({ address: "10.0.0.5:4318", code: "K7Q-4XM" });
    expect(parseInvite("hello")).toBeNull();
  });

  it("closes the network port when the person stops sharing", async () => {
    await host("/api/share", { on: false });
    await expect(fetch(`${net}/api/health`, { headers: { origin: ORIGIN } })).rejects.toThrow();
  });
});
