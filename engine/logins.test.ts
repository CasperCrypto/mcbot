import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Logins, loginSite, sameSite } from "./logins";
import { startEngine, type Engine } from "./server";

describe("logins", () => {
  it("reads a site from what people type", () => {
    expect(loginSite("mail.google.com/mail/u/0")).toEqual({ url: "https://mail.google.com", host: "mail.google.com" });
    expect(loginSite("http://localhost:3000/login")).toEqual({ url: "http://localhost:3000", host: "localhost" });
    expect(loginSite("javascript:alert(1)")).toBeNull();
    expect(loginSite("nonsense")).toBeNull();
    expect(sameSite("github.com", "www.github.com")).toBe(true);
    expect(sameSite("github.com", "gist.github.com")).toBe(true);
    expect(sameSite("github.com", "evilgithub.com")).toBe(false);
    expect(sameSite("mail.google.com", "google.com")).toBe(false);
  });

  it("keeps passwords sealed on disk, lists them without, and gives one back on request", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcbot-logins-"));
    const store = new Logins(join(dir, "logins.json"), join(dir, "data", "logins.key"));
    const made = await store.put({ url: "github.com", username: "kacper", password: "s3cret-pass" }, 1);
    expect(made).not.toHaveProperty("password");
    expect(readFileSync(join(dir, "logins.json"), "utf8")).not.toContain("s3cret-pass");
    expect((await store.list("gist.github.com")).map((l) => l.username)).toEqual(["kacper"]);
    expect(await store.list("gitlab.com")).toEqual([]);
    expect(JSON.stringify(await store.list())).not.toContain("s3cret");
    expect((await store.reveal(made.id)).password).toBe("s3cret-pass");
    // A change without a password keeps the saved one.
    await store.put({ id: made.id, url: "github.com", username: "kacper2" });
    expect(await store.reveal(made.id)).toEqual({ username: "kacper2", password: "s3cret-pass", host: "github.com" });
    await expect(store.put({ url: "gitlab.com", username: "x" })).rejects.toThrow("Type the password");
    // Without its key (the folder copied to another computer), a password can't be read.
    rmSync(join(dir, "data"), { recursive: true });
    await expect(new Logins(join(dir, "logins.json"), join(dir, "data", "logins.key")).reveal(made.id)).rejects.toThrow("another computer");
  });
});

describe("logins over the engine", () => {
  const ORIGIN = "tauri://localhost";
  // Below 32768: no ephemeral port can take it.
  const SHARE_PORT = 25_000 + Math.floor(Math.random() * 2000);
  let engine: Engine;
  beforeAll(async () => {
    const workspace = mkdtempSync(join(tmpdir(), "mcbot-logins-engine-"));
    engine = await startEngine({ workspace, hermesHome: join(workspace, "hermes"), managedRoot: true, port: 0, host: "127.0.0.1", allowedOrigins: [ORIGIN], sharePort: SHARE_PORT, dataDir: join(workspace, "data") });
  });
  afterAll(() => engine?.close());
  const host = (path: string, body?: unknown) => fetch(`${engine.url}${path}`, { method: body === undefined ? "GET" : "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

  it("are this computer's own: never to a web page, never to someone who joined", async () => {
    const saved = (await (await host("/api/logins", { url: "https://github.com", username: "kacper", password: "pw-123" })).json()) as { login: { id: string } };
    const reveal = await host("/api/logins/reveal", { id: saved.login.id });
    expect(((await reveal.json()) as { password: string }).password).toBe("pw-123");
    // Another site in the person's own browser can't ask for it.
    const evil = await fetch(`${engine.url}/api/logins/reveal`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ id: saved.login.id }) });
    expect(evil.status).toBe(403);
    // A teammate who joined can't either.
    const share = (await (await host("/api/share", { on: true, reach: "network" })).json()) as { invite: { code: string } };
    const { key } = (await (await fetch(`http://127.0.0.1:${SHARE_PORT}/api/join`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ code: share.invite.code, name: "Ana" }) })).json()) as { key: string };
    for (const [path, body] of [["/api/logins", undefined], ["/api/logins/reveal", { id: saved.login.id }]] as const) {
      const res = await fetch(`http://127.0.0.1:${SHARE_PORT}${path}`, { method: body ? "POST" : "GET", headers: { origin: ORIGIN, authorization: `Bearer ${key}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      expect(res.status).toBe(403);
    }
    await host("/api/share", { on: false });
  });
});
