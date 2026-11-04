import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { addEdge, addNode, graphFromDoc, setNodeField } from "../src/board/ydoc";
import type { CompileResponse } from "../src/contracts/api";
import type { RunEvent, RunSummary } from "../src/contracts/run";
import { startStubLlm, type StubLlm } from "../test/stub-llm/server";
import { startEngine, type Engine } from "./server";

const ORIGIN = "http://localhost:5173";
let engine: Engine;
let stub: StubLlm;
let workspace: string;

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), "mcbot-engine-"));
  stub = await startStubLlm();
  engine = await startEngine({ workspace, hermesHome: join(workspace, "hermes"), managedRoot: true, port: 0, host: "127.0.0.1", allowedOrigins: [ORIGIN] });
  await engine.relay.create("team", "Team board");
});
afterAll(async () => {
  await engine?.close();
  await stub?.close();
});

const api = async <T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> => {
  const res = await fetch(`${engine.url}${path}`, { ...init, headers: { origin: ORIGIN, "content-type": "application/json", ...(init.headers ?? {}) } });
  return { status: res.status, body: (await res.json()) as T };
};

function client(): { doc: Y.Doc; provider: WebsocketProvider } {
  const doc = new Y.Doc();
  // disableBc: Node 22 has a global BroadcastChannel, which would let two in-process
  // clients sync with each other directly and hide a broken relay.
  const provider = new WebsocketProvider(`${engine.url.replace("http", "ws")}/board`, "team", doc, {
    disableBc: true,
    WebSocketPolyfill: class extends WebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols, { headers: { origin: ORIGIN } });
      }
    } as unknown as typeof globalThis.WebSocket,
  });
  return { doc, provider };
}

const until = async (cond: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe("engine", () => {
  it("rejects browser origins it does not know (no drive-by compiles or runs)", async () => {
    const res = await fetch(`${engine.url}/api/health`, { headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    const ok = await api<{ ok: boolean }>("/api/health");
    expect(ok.body.ok).toBe(true);
  });

  it("shares one board between two clients live, with presence, and persists it as JSON", async () => {
    const a = client();
    const b = client();
    await until(() => a.provider.synced && b.provider.synced);

    a.provider.awareness.setLocalStateField("user", { name: "Ada", color: "#0a84ff" });
    a.provider.awareness.setLocalStateField("cursor", { x: 10, y: 20 });
    addNode(a.doc, { id: "n-agent", kind: "agent", position: { x: 0, y: 0 }, data: { name: "triage", displayName: "Triage", description: "Routes tickets.", soul: "", skills: [], capabilities: null } });
    addNode(a.doc, { id: "n-model", kind: "model", position: { x: -300, y: 0 }, data: { name: "local", label: "Local", endpoint: "local", baseUrl: stub.url, model: "stub-model", apiKeyEnv: "", pricing: { inputPerMTok: 0.1, outputPerMTok: 0.2 } } });
    addEdge(a.doc, { id: "e1", source: "n-agent", target: "n-model", order: 0 });

    await until(() => graphFromDoc(b.doc).nodes.length === 2 && graphFromDoc(b.doc).edges.length === 1);
    await until(() => [...b.provider.awareness.getStates().values()].some((s) => s.user?.name === "Ada" && s.cursor?.x === 10));

    setNodeField(b.doc, "n-agent", "displayName", "Triage desk");
    await until(() => (graphFromDoc(a.doc).nodes.find((n) => n.id === "n-agent")?.data as { displayName?: string } | undefined)?.displayName === "Triage desk");

    await engine.relay.flush();
    const saved = JSON.parse(readFileSync(join(workspace, "boards/team.json"), "utf8"));
    expect(saved.nodes.map((n: { id: string }) => n.id)).toEqual(["n-agent", "n-model"]);
    a.provider.destroy();
    b.provider.destroy();
  });

  it("compiles the live shared board into a Hermes profile on disk", async () => {
    const { body } = await api<CompileResponse>("/api/compile", { method: "POST", body: JSON.stringify({ boardId: "team" }) });
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    expect(body.report.changes.map((c) => [c.path, c.status])).toEqual([
      [".mcbot/manifest.json", "added"],
      ["profiles/triage/.no-bundled-skills", "added"],
      ["profiles/triage/SOUL.md", "added"],
      ["profiles/triage/config.yaml", "added"],
      ["profiles/triage/profile.yaml", "added"],
    ]);
    expect(body.gateway).toBe("restart-pending");
    const cfg = readFileSync(join(workspace, "hermes/profiles/triage/config.yaml"), "utf8");
    expect(cfg).toContain(`api: ${stub.url}\n`);
    expect(existsSync(join(workspace, "hermes/profiles/triage/skills"))).toBe(true);

    const again = await api<CompileResponse>("/api/compile?boardId=team");
    expect(again.body.ok && again.body.report.changes.every((c) => c.status === "unchanged")).toBe(true);
  });

  // MCBOT_HERMES_BIN: a given Hermes; MCBOT_E2E=1: McBot's own (hermes/, after `npm run hermes:setup`).
  it.skipIf(!process.env.MCBOT_HERMES_BIN && process.env.MCBOT_E2E !== "1")("runs the compiled agent through real Hermes and records events, memory and cost", async () => {
    const { body } = await api<{ runId: string }>("/api/runs", { method: "POST", body: JSON.stringify({ boardId: "team", agentNodeId: "n-agent", prompt: "remember: Tickets about billing go to Sam" }) });
    expect(body.runId).toMatch(/^run_/);
    let events: RunEvent[] = [];
    const end = Date.now() + 240_000;
    while (Date.now() < end) {
      events = (await api<RunEvent[]>(`/api/runs/${body.runId}`)).body;
      if (events.some((e) => e.type === "run.cost") || events.some((e) => e.type === "run.finished" && e.status !== "succeeded")) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const finished = events.find((e) => e.type === "run.finished");
    expect(finished, JSON.stringify(events.filter((e) => e.type !== "run.log").slice(-5))).toMatchObject({ status: "succeeded", exitCode: 0, text: "Saved to memory: Tickets about billing go to Sam" });
    expect(events.find((e) => e.type === "run.tool.started")).toMatchObject({ tool: "memory" });
    expect(events.find((e) => e.type === "run.cost")).toMatchObject({ model: "stub-model", provider: "custom", costStatus: "unknown", estimatedUsd: expect.any(Number) });

    const memory = await api<{ profile: string; memory: { entries: string[] } }[]>("/api/memory?boardId=team");
    expect(memory.body[0]!.memory.entries).toContain("Tickets about billing go to Sam");
    const cost = await api<{ totals: { sessions: number; successfulRuns: number } }>("/api/cost?boardId=team");
    expect(cost.body.totals).toMatchObject({ sessions: 1, successfulRuns: 1 });
    const runs = await api<RunSummary[]>("/api/runs?boardId=team");
    expect(runs.body[0]).toMatchObject({ status: "succeeded", profile: "triage" });
  }, 300_000);

  // The agent's abilities and its image maker, as Hermes reads them: only the chosen tool sets are
  // offered to the model, and image_generate goes to the wired provider with the saved key.
  it.skipIf(!process.env.MCBOT_HERMES_BIN && process.env.MCBOT_E2E !== "1")("gives an agent only its chosen abilities and makes an image with its image maker", async () => {
    const a = client();
    await until(() => a.provider.synced);
    addNode(a.doc, { id: "n-artist", kind: "agent", position: { x: 0, y: 300 }, data: { name: "artist", displayName: "Artist", description: "", soul: "", skills: [], capabilities: ["file", "image_gen", "memory"] } });
    addNode(a.doc, { id: "n-pictures", kind: "media", position: { x: 300, y: 300 }, data: { name: "pictures", label: "Pictures", media: "image", provider: "openai", model: "" } });
    addEdge(a.doc, { id: "e-artist-model", source: "n-artist", target: "n-model", order: 0 });
    addEdge(a.doc, { id: "e-artist-pictures", source: "n-artist", target: "n-pictures", order: 0 });
    await until(() => graphFromDoc(a.doc).nodes.length === 4);
    await engine.relay.flush();
    a.provider.destroy();

    expect((await api("/api/secrets", { method: "POST", body: JSON.stringify({ name: "MCBOT_PROBE_KEY", value: "probe-123" }) })).status).toBe(200);
    const b2 = client();
    await until(() => b2.provider.synced);
    setNodeField(b2.doc, "n-model", "apiKeyEnv", "MCBOT_PROBE_KEY");
    await until(() => (graphFromDoc(b2.doc).nodes.find((n) => n.id === "n-model")?.data as { apiKeyEnv?: string }).apiKeyEnv === "MCBOT_PROBE_KEY");
    await engine.relay.flush();
    b2.provider.destroy();
    expect((await api("/api/secrets", { method: "POST", body: JSON.stringify({ name: "OPENAI_API_KEY", value: "sk-stub" }) })).status).toBe(200);
    const compiled = await api<CompileResponse>("/api/compile", { method: "POST", body: JSON.stringify({ boardId: "team" }) });
    expect(compiled.body.ok).toBe(true);
    const cfg = readFileSync(join(workspace, "hermes/profiles/artist/config.yaml"), "utf8");
    expect(cfg).toContain("platform_toolsets:\n  cli:\n    - file\n    - image_gen\n    - memory\nimage_gen:\n  provider: openai\n");
    // Point the OpenAI image maker at the stub, as a line someone added with Hermes itself:
    // McBot keeps it and adds its own key block after it.
    const envFile = join(workspace, "hermes/profiles/artist/.env");
    writeFileSync(envFile, `OPENAI_BASE_URL=${stub.url}\n`);

    const { body } = await api<{ runId: string }>("/api/runs", { method: "POST", body: JSON.stringify({ boardId: "team", agentNodeId: "n-artist", prompt: 'call:image_generate {"prompt":"a burger mascot, flat colours"}' }) });
    let events: RunEvent[] = [];
    const end = Date.now() + 240_000;
    while (Date.now() < end) {
      events = (await api<RunEvent[]>(`/api/runs/${body.runId}`)).body;
      if (events.some((e) => e.type === "run.finished")) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(events.find((e) => e.type === "run.finished"), JSON.stringify(events.filter((e) => e.type !== "run.log").slice(-6))).toMatchObject({ status: "succeeded" });

    const asked = stub.requests.filter((r) => r.tools?.length && JSON.stringify(r.messages).includes("burger mascot"));
    const offered = new Set(asked[0]!.tools!.map((t) => t.function?.name));
    // Hermes may defer image_generate behind its tool_search / tool_call bridge (tools/tool_search.py).
    expect(offered.has("image_generate") || offered.has("tool_call")).toBe(true);
    expect(offered.has("memory")).toBe(true);
    expect(offered.has("web_search")).toBe(false);
    expect(offered.has("terminal")).toBe(false);
    // The model's key, saved in McBot, reached the model: Hermes' gateway reads it from the profile's .env.
    expect(stub.authorizations[stub.requests.indexOf(asked[0]!)]).toBe("Bearer probe-123");
    expect(readFileSync(envFile, "utf8")).toMatch(/^OPENAI_BASE_URL=http:.*\n\n# >>> McBot keys.*\nMCBOT_PROBE_KEY="probe-123"\nOPENAI_API_KEY="sk-stub"\n# <<< McBot keys\n$/);
    if (process.platform !== "win32") expect(statSync(envFile).mode & 0o777).toBe(0o600);
    const listing = await api<{ entries: { name: string }[] }>("/api/fs/list?root=profile:artist&path=");
    expect(listing.body.entries.map((e) => e.name)).not.toContain(".env");

    expect(stub.imageRequests).toHaveLength(1);
    expect(stub.imageRequests[0]).toMatchObject({ prompt: expect.stringContaining("burger mascot") });
    const done = events.find((e): e is Extract<RunEvent, { type: "run.tool.finished" }> => e.type === "run.tool.finished" && e.tool === "image_generate");
    expect(done?.isError).toBe(false);
    const image = (JSON.parse(done!.output) as { image?: string }).image!;
    expect(image.startsWith(join(workspace, "hermes/profiles/artist/"))).toBe(true);
    expect(readFileSync(image).subarray(1, 4).toString()).toBe("PNG");
  }, 300_000);
});
