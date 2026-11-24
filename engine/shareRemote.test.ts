/**
 * Share with anyone: the app in a web browser (served on the share port), links through a quick
 * tunnel (a stand-in for cloudflared here), and guests who may only chat with some agents and see
 * only their own runs.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { addNode } from "../src/board/ydoc";
import { cloudflaredAsset, releaseChecksum, QUICK_URL } from "./tunnel";
import { cleanOwnUrl } from "./sharing";
import { webFile } from "./webApp";
import { startEngine, type Engine } from "./server";

const ORIGIN = "tauri://localhost";
const PUBLIC = "https://quiet-river-test.trycloudflare.com";
const SHARE_PORT = 49_000 + Math.floor(Math.random() * 2000);
const net = `http://127.0.0.1:${SHARE_PORT}`;
let engine: Engine;
let web = "";

beforeAll(async () => {
  const workspace = mkdtempSync(join(tmpdir(), "mcbot-share-web-"));
  web = join(workspace, "web");
  mkdirSync(join(web, "assets"), { recursive: true });
  writeFileSync(join(web, "index.html"), "<!doctype html><div id=root></div><script type=module src=/assets/app.js></script>");
  writeFileSync(join(web, "assets", "app.js"), "console.log('app')");
  writeFileSync(join(web, ".secret"), "no");
  writeFileSync(join(workspace, "outside.txt"), "no");
  engine = await startEngine({
    workspace, hermesHome: join(workspace, "hermes"), managedRoot: true, port: 0, host: "127.0.0.1", allowedOrigins: [ORIGIN],
    sharePort: SHARE_PORT, webDir: web,
    // cloudflared prints its address in a box on stderr; this stand-in does the same and waits.
    launchTunnel: async () => spawn(process.execPath, ["-e", `console.error("INF |  ${PUBLIC}  |"); setInterval(() => {}, 1000)`], { stdio: ["ignore", "pipe", "pipe"] }),
  });
  await engine.relay.create("team", "Team");
});
afterAll(() => engine?.close());

const host = async <T>(path: string, body?: unknown) => {
  const res = await fetch(`${engine.url}${path}`, { method: body === undefined ? "GET" : "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return (await res.json()) as T;
};
const remote = (path: string, init: { method?: string; key?: string; body?: unknown; origin?: string | null; headers?: Record<string, string> } = {}) =>
  fetch(`${net}${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: { ...(init.origin === null ? {} : { origin: init.origin ?? PUBLIC }), "content-type": "application/json", ...(init.key ? { authorization: `Bearer ${init.key}` } : {}), ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
const until = async (cond: () => boolean | Promise<boolean>, ms = 5000) => {
  for (const end = Date.now() + ms; !(await cond()); ) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
};
type View = { on: boolean; reach: string; publicUrl: string | null; link: string | null; tunnel: { state: string }; web: boolean; invites: { role: string; code: string; link: string | null; agents?: string[] }[]; members: { name: string; role: string }[] };

describe("the pieces", () => {
  it("picks cloudflared's file for each computer and reads its checksum from the release notes", () => {
    expect(cloudflaredAsset("darwin", "arm64")).toBe("cloudflared-darwin-arm64.tgz");
    expect(cloudflaredAsset("darwin", "x64")).toBe("cloudflared-darwin-amd64.tgz");
    expect(cloudflaredAsset("win32", "x64")).toBe("cloudflared-windows-amd64.exe");
    expect(cloudflaredAsset("win32", "arm64")).toBe("cloudflared-windows-amd64.exe");
    expect(cloudflaredAsset("linux", "arm64")).toBe("cloudflared-linux-arm64");
    expect(cloudflaredAsset("freebsd", "x64")).toBeNull();
    const body = "### SHA256 Checksums:\n```\n    cloudflared-linux-amd64: 56f13335143ec0e22772963290683a84a04114a35ec64cbc794a4d39ff9bb8cf\n    cloudflared-linux-amd64.deb: 1111111111111111111111111111111111111111111111111111111111111111\n```";
    expect(releaseChecksum(body, "cloudflared-linux-amd64")).toBe("56f13335143ec0e22772963290683a84a04114a35ec64cbc794a4d39ff9bb8cf");
    expect(releaseChecksum(body, "cloudflared-linux-arm64")).toBeNull();
    expect(QUICK_URL.exec("2026-11-24T00:00:00Z INF |  https://a-b-c.trycloudflare.com    |")?.[0]).toBe("https://a-b-c.trycloudflare.com");
  });

  it("serves only the app's own files", () => {
    expect(webFile(web, "/assets/app.js")?.immutable).toBe(true);
    expect(webFile(web, "/index.html")?.type).toContain("text/html");
    for (const bad of ["/../outside.txt", "/assets/../../outside.txt", "/%2e%2e/outside.txt", "/.secret", "/assets/", "/nothing.js", "/%00"]) expect(webFile(web, bad)).toBeNull();
    expect(cleanOwnUrl("https://team.example.com/")).toBe("https://team.example.com");
    expect(cleanOwnUrl("https://team.example.com/path")).toBeNull();
    expect(cleanOwnUrl("ftp://x")).toBeNull();
  });
});

describe("sharing with anyone", () => {
  let teammate = "";
  let guest = "";
  let other = "";
  let support = "";

  it("makes a link anyone can open, through the tunnel", async () => {
    const view = await host<View>("/api/share", { on: true, reach: "internet" });
    expect(view.on).toBe(true);
    await until(async () => (await host<View>("/api/share")).tunnel.state === "on");
    const now = await host<View>("/api/share");
    expect(now.publicUrl).toBe(PUBLIC);
    expect(now.web).toBe(true);
    const edit = now.invites.find((i) => i.role === "edit")!;
    expect(edit.link).toBe(`${PUBLIC}/join?code=${encodeURIComponent(edit.code)}`);
    expect(now.link).toBe(edit.link);
    // A page from the tunnel's address may join; another site may not.
    expect((await remote("/api/join", { body: { code: edit.code, name: "Ana" }, origin: "https://evil.example" })).status).toBe(403);
    const joined = await remote("/api/join", { body: { code: edit.code, name: "Ana" } });
    expect(joined.status).toBe(200);
    const body = (await joined.json()) as { key: string; role: string; host: string };
    expect(body.role).toBe("edit");
    teammate = body.key;
  });

  it("opens the app itself in a web browser, with a strict policy", async () => {
    const page = await remote("/join?code=ABC-DEF-GHJ", { origin: null });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<div id=root>');
    expect(page.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    const js = await remote("/assets/app.js", { origin: null });
    expect(js.headers.get("content-type")).toContain("javascript");
    expect(js.headers.get("cache-control")).toContain("immutable");
    expect((await remote("/.secret", { origin: null })).status).toBe(404);
    expect((await remote("/assets/../../outside.txt", { origin: null })).status).toBe(404);
    // The app's own requests: same-origin GETs carry no Origin, the member key is what counts.
    expect((await remote("/api/boards", { origin: null, key: teammate })).status).toBe(200);
    expect((await remote("/api/boards", { origin: null })).status).toBe(403);
    expect((await remote("/api/share/hello", { origin: null })).status).toBe(200);
  });

  it("gives guests a link to chat with the agents picked, and nothing else", async () => {
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(`${engine.url.replace("http", "ws")}/board`, "team", doc, {
      disableBc: true,
      WebSocketPolyfill: class extends WebSocket {
        constructor(u: string | URL, p?: string | string[]) {
          super(u, p, { headers: { origin: ORIGIN } });
        }
      } as unknown as typeof globalThis.WebSocket,
    });
    await until(() => provider.synced);
    const agent = (id: string, name: string) => addNode(doc, { id, kind: "agent", position: { x: 0, y: 0 }, data: { name, displayName: "", description: `${name} desk`, soul: "", skills: [], capabilities: ["web"] } });
    agent("a-support", "support");
    agent("a-private", "private");
    await until(async () => ((await host<{ nodes?: unknown[] }>("/api/boards")) as unknown as { id: string }[]).length > 0);
    await new Promise((r) => setTimeout(r, 200));
    provider.destroy();

    const view = await host<View>("/api/share/invite", { role: "chat", boardId: "team", agents: ["a-support"] });
    const chat = view.invites.find((i) => i.role === "chat")!;
    expect(chat.agents).toEqual(["a-support"]);
    expect(chat.link).toContain(PUBLIC);
    // The teammates' link still works beside it.
    expect(view.invites.some((i) => i.role === "edit")).toBe(true);
    const a = (await (await remote("/api/join", { body: { code: chat.code, name: "Customer" } })).json()) as { key: string; role: string };
    expect(a.role).toBe("chat");
    guest = a.key;
    other = ((await (await remote("/api/join", { body: { code: chat.code, name: "Other customer" } })).json()) as { key: string }).key;

    const me = (await (await remote("/api/guest", { key: guest })).json()) as { role: string; boardId: string; agents: { id: string; displayName: string }[] };
    expect(me.role).toBe("chat");
    expect(me.boardId).toBe("team");
    expect(me.agents.map((x) => x.id)).toEqual(["a-support"]);
    support = me.agents[0]!.id;
    // Not the board, its tasks, memory, cost or compile; not another agent.
    for (const path of ["/api/boards", "/api/tasks?boardId=team", "/api/memory?boardId=team", "/api/cost?boardId=team", "/api/compile?boardId=team", "/api/secrets"]) {
      expect((await remote(path, { key: guest })).status).toBe(403);
    }
    expect((await remote("/api/runs", { key: guest, body: { boardId: "team", agentNodeId: "a-private", prompt: "hi" } })).status).toBe(403);
    // No board over a WebSocket either.
    const refused = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${SHARE_PORT}/board/team?key=${guest}`, { headers: { origin: PUBLIC } });
      ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      ws.on("open", () => { ws.close(); resolve(101); });
      ws.on("error", () => undefined);
    });
    expect(refused).toBe(403);
  });

  it("shows each guest only their own runs, over a WebSocket, with no paths from this computer", async () => {
    const listen = (key: string) => {
      const got: { runId: string; type: string; hermesHome?: string }[] = [];
      const ws = new WebSocket(`ws://127.0.0.1:${SHARE_PORT}/api/events?key=${key}`, { headers: { origin: PUBLIC } });
      ws.on("message", (m) => {
        const f = JSON.parse(String(m)) as { run?: { runId: string; type: string; hermesHome?: string } };
        if (f.run) got.push(f.run);
      });
      return { ws, got, open: new Promise<void>((r) => ws.on("open", () => r())) };
    };
    const g = listen(guest);
    const t = listen(teammate);
    await Promise.all([g.open, t.open]);
    const me = (await (await remote("/api/guest", { key: guest })).json()) as { name: string };
    const start = (runId: string, by?: { id: string; name: string }) => engine.store.emit(runId, {
      type: "run.started", boardId: "team", agentNodeId: support, profile: "support", prompt: "When do you open?",
      argv: ["chat"], hermesHome: "/Users/host/McBot/hermes", cwd: "/Users/host/McBot/hermes/profiles/support/workspace", ...(by ? { by: by.id, byName: by.name } : {}),
    });
    const members = (await host<{ members: { id: string; name: string }[] }>("/api/share")).members;
    const guestId = members.find((m) => m.name === me.name)!.id;
    start("run_mine_aaaaaaaa", { id: guestId, name: me.name });
    start("run_host_bbbbbbbb");
    await until(() => t.got.length >= 2);
    await new Promise((r) => setTimeout(r, 150));
    expect(g.got.map((e) => e.runId)).toEqual(["run_mine_aaaaaaaa"]);
    expect(g.got[0]!.hermesHome).toBe("");
    expect(t.got.map((e) => e.runId).sort()).toEqual(["run_host_bbbbbbbb", "run_mine_aaaaaaaa"]);

    const listed = (await (await remote("/api/runs?boardId=team", { key: guest })).json()) as { runId: string; byName?: string }[];
    expect(listed.map((r) => r.runId)).toEqual(["run_mine_aaaaaaaa"]);
    expect(listed[0]!.byName).toBe(me.name);
    expect((await remote("/api/runs/run_host_bbbbbbbb", { key: guest })).status).toBe(404);
    expect((await remote("/api/runs/run_mine_aaaaaaaa", { key: other })).status).toBe(404);
    const events = (await (await remote("/api/runs/run_mine_aaaaaaaa", { key: guest })).json()) as { cwd?: string }[];
    expect(events[0]!.cwd).toBe("");
    // Only the host answers what an agent asks.
    expect((await remote("/api/runs/run_mine_aaaaaaaa/approval", { key: guest, body: { choice: "once" } })).status).toBe(403);
    g.ws.close();
    t.ws.close();
  });

  it("slows down someone guessing codes, without locking out everyone else", async () => {
    const guess = (who: string) => remote("/api/join", { body: { code: "WRONG-CODE-XX", name: "x" }, headers: { "cf-connecting-ip": who } });
    for (let i = 0; i < 5; i++) expect((await guess("203.0.113.9")).status).toBe(403);
    const view = await host<View>("/api/share");
    const edit = view.invites.find((i) => i.role === "edit")!;
    // Locked out after five wrong tries in a minute, even with the right code…
    expect((await remote("/api/join", { body: { code: edit.code, name: "Late" }, headers: { "cf-connecting-ip": "203.0.113.9" } })).status).toBe(403);
    // …while someone else still gets in.
    expect((await remote("/api/join", { body: { code: edit.code, name: "Lee" }, headers: { "cf-connecting-ip": "198.51.100.4" } })).status).toBe(200);
  });

  it("stops the tunnel with sharing", async () => {
    const view = await host<View>("/api/share", { on: false });
    expect(view.tunnel.state).toBe("off");
    expect(view.invites).toEqual([]);
  });
});
