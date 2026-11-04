import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BoardInfo, SetupDetect, SetupState } from "../src/contracts/api";
import { startStubLlm, type StubLlm } from "../test/stub-llm/server";
import { Runner } from "./runner";
import { RunStore } from "./runStore";
import { Secrets } from "./secrets";
import { startEngine, type Engine } from "./server";
import { detectLocal, listModels } from "./setup";

const ORIGIN = "http://localhost:5173";
let stub: StubLlm;
let engine: Engine;
let workspace: string;

beforeAll(async () => {
  stub = await startStubLlm();
  workspace = mkdtempSync(join(tmpdir(), "mcbot-setup-"));
  engine = await startEngine({ workspace, hermesHome: join(workspace, "hermes"), managedRoot: true, port: 0, host: "127.0.0.1", allowedOrigins: [ORIGIN] });
  await engine.relay.create("main", "My first harness");
});
afterAll(async () => {
  await engine?.close();
  await stub?.close();
});

const api = async <T>(path: string, body?: unknown): Promise<{ status: number; body: T }> => {
  const res = await fetch(`${engine.url}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
};

const graph = (name: string) => ({
  schema: "mcbot.graph/v1", id: "x", name,
  nodes: [{ id: "a1", kind: "agent", position: { x: 0, y: 0 }, data: { name: "assistant", displayName: "Assistant", description: "", soul: "Help.", skills: [] } }],
  edges: [],
});

describe("model servers", () => {
  it("lists an OpenAI-compatible server's models and skips servers that do not answer", async () => {
    expect(await listModels(stub.url)).toEqual(["stub-model"]);
    expect(await listModels("http://127.0.0.1:9/v1", undefined, 300)).toBeNull();
    expect(await listModels("file:///etc/passwd")).toBeNull();
    const found = await detectLocal([{ name: "Stub", baseUrl: stub.url }, { name: "Nothing", baseUrl: "http://127.0.0.1:9/v1" }]);
    expect(found).toEqual([{ name: "Stub", baseUrl: stub.url, models: ["stub-model"] }]);
  });
});

describe("secrets", () => {
  it("keeps values owner-only on disk and hands out names, never values", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcbot-secrets-"));
    const s = new Secrets(join(dir, "secrets.json"));
    await s.set("OPENROUTER_API_KEY", "  sk-or-123  ");
    expect(await s.names()).toEqual(["OPENROUTER_API_KEY"]);
    expect(await s.env()).toEqual({ OPENROUTER_API_KEY: "sk-or-123" });
    if (process.platform !== "win32") expect(statSync(join(dir, "secrets.json")).mode & 0o777).toBe(0o600);
    await expect(s.set("lower-case", "x")).rejects.toThrow();
    await expect(s.set("KEY", "two\nlines")).rejects.toThrow();
    await s.remove("OPENROUTER_API_KEY");
    expect(await s.names()).toEqual([]);
  });

  it("passes saved keys to Hermes as environment variables", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcbot-env-"));
    const out = join(dir, "seen");
    const fake = join(dir, "hermes");
    writeFileSync(fake, `#!/bin/sh\nprintf '%s|%s' "$MCBOT_TEST_KEY" "$HERMES_HOME" > '${out}'\n`);
    chmodSync(fake, 0o755);
    mkdirSync(join(dir, "root", "profiles", "assistant", "workspace"), { recursive: true });
    const store = new RunStore(join(dir, "runs"));
    const done = new Promise<void>((resolve) => store.subscribe((e) => { if (e.type === "run.finished") resolve(); }));
    const runner = new Runner({ store, root: join(dir, "root"), managedRoot: false, findHermes: async () => ({ path: fake, shell: false, kind: "external" as const }), secrets: async () => ({ MCBOT_TEST_KEY: "sk-test" }) });
    await runner.start({ boardId: "b", agentNodeId: "a", profile: "assistant", prompt: "hi", toolNodes: [], models: [] });
    await done;
    expect(readFileSync(out, "utf8")).toBe(`sk-test|${join(dir, "root")}`);
  }, 15_000);
});

describe("setup routes", () => {
  it("starts incomplete, fills the empty first board, then creates new ones", async () => {
    expect((await api<SetupState>("/api/setup")).body).toEqual({ completed: false, profile: null });

    const first = await api<BoardInfo>("/api/setup/board", { name: "Acme", graph: graph("Acme") });
    expect(first.body).toEqual({ id: "main", name: "Acme" });
    expect((await engine.relay.graph("main")).nodes.map((n) => n.id)).toEqual(["a1"]);

    const second = await api<BoardInfo>("/api/setup/board", { name: "Acme Ops", graph: graph("Acme Ops") });
    expect(second.body.id).toMatch(/^acme-ops-[0-9a-f]{4}$/);
    expect((await engine.relay.graph(second.body.id)).name).toBe("Acme Ops");

    const profile = { kind: "company", name: "Maya", company: "Acme", about: "Invoicing for small shops", role: "Head of support" };
    expect((await api<SetupState>("/api/setup/complete", { profile })).body).toEqual({ completed: true, profile });
    expect((await api<SetupState>("/api/setup")).body.completed).toBe(true);
  });

  it("stores keys by name and lists models through them", async () => {
    expect((await api<{ names: string[] }>("/api/secrets", { name: "STUB_KEY", value: "sk-1" })).body).toEqual({ names: ["STUB_KEY"] });
    expect((await api<{ error: string }>("/api/secrets", { name: "bad name", value: "x" })).status).toBe(400);
    const detect = (await api<SetupDetect>("/api/setup/detect")).body;
    expect(detect.secrets).toEqual(["STUB_KEY"]);
    expect(JSON.stringify(detect)).not.toContain("sk-1");
    expect((await api<{ models: string[] | null }>("/api/setup/models", { baseUrl: stub.url, keyName: "STUB_KEY" })).body.models).toEqual(["stub-model"]);
  });
});

describe("a gateway that is still starting", () => {
  it("gets one more attempt, so a new home's first message still answers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcbot-retry-"));
    const count = join(dir, "attempts");
    const fake = join(dir, "hermes");
    // First launch: Hermes reports the gateway was not ready; second: it answers.
    writeFileSync(fake, [
      "#!/bin/sh",
      `n=$(cat '${count}' 2>/dev/null || echo 0); n=$((n+1)); echo $n > '${count}'`,
      'if [ "$n" = 1 ]; then echo \'{"type":"result","session_id":"","exit_code":1,"text":"","error":"Gateway starting: deadline"}\'; exit 1; fi',
      'echo \'{"type":"text","text":"4"}\'',
      'echo \'{"type":"result","session_id":"s1","exit_code":0,"text":"4","tokens":{"input":1,"output":1,"total":2,"cache_read":0,"cache_write":0},"duration_ms":5}\'',
    ].join("\n"));
    chmodSync(fake, 0o755);
    mkdirSync(join(dir, "root", "profiles", "assistant", "workspace"), { recursive: true });
    const store = new RunStore(join(dir, "runs"));
    const events: string[] = [];
    const done = new Promise<void>((resolve) => store.subscribe((e) => {
      if (e.type === "run.finished") { events.push(`${e.status}:${e.text}`); resolve(); }
      if (e.type === "run.log" && e.line.startsWith("[mcbot]")) events.push("retry");
    }));
    const runner = new Runner({ store, root: join(dir, "root"), managedRoot: false, findHermes: async () => ({ path: fake, shell: false, kind: "external" as const }) });
    await runner.start({ boardId: "b", agentNodeId: "a", profile: "assistant", prompt: "what is 2+2", toolNodes: [], models: [] });
    await done;
    expect(events).toEqual(["retry", "succeeded:4"]);
    expect(readFileSync(count, "utf8").trim()).toBe("2");
  }, 15_000);
});
