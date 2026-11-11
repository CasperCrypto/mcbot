import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BoardExport, BoardInfo } from "../src/contracts/api";
import { GRAPH_SCHEMA, type Graph } from "../src/contracts/graph";
import { exportFileName, exportText } from "./boardFiles";
import { startEngine, type Engine } from "./server";

describe("exportFileName", () => {
  it("turns a board name into a file name that is not taken yet", () => {
    expect(exportFileName("Support desk", () => false)).toBe("support-desk.mcbot.json");
    expect(exportFileName("Équipe ✨ Marketing", () => false)).toBe("equipe-marketing.mcbot.json");
    expect(exportFileName("", () => false)).toBe("board.mcbot.json");
    const taken = new Set(["support-desk.mcbot.json", "support-desk-2.mcbot.json"]);
    expect(exportFileName("Support desk", (f) => taken.has(f))).toBe("support-desk-3.mcbot.json");
  });
});

describe("board files through the engine", () => {
  const ORIGIN = "http://localhost:5173";
  let engine: Engine;
  let workspace: string;
  const board: Graph = {
    schema: GRAPH_SCHEMA, id: "support", name: "Support desk",
    nodes: [
      { id: "agent-1", kind: "agent", position: { x: 0, y: 0 }, data: { name: "triage", displayName: "Triage desk" } },
      { id: "model-1", kind: "model", position: { x: -300, y: 0 }, data: { name: "cloud", endpoint: "cloud", apiKeyEnv: "CLOUD_KEY" } },
    ],
    edges: [{ id: "edge-1", source: "agent-1", target: "model-1", order: 0 }],
  } as unknown as Graph;
  const post = async <T>(path: string, body: unknown): Promise<{ status: number; body: T }> => {
    const res = await fetch(`${engine.url}${path}`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as T };
  };

  beforeAll(async () => {
    workspace = mkdtempSync(join(tmpdir(), "mcbot-boardfiles-"));
    engine = await startEngine({ workspace, hermesHome: join(workspace, "hermes"), managedRoot: true, port: 0, host: "127.0.0.1", allowedOrigins: [ORIGIN] });
    await engine.relay.create("support", "Support desk", board);
  });
  afterAll(async () => {
    await engine?.close();
  });

  it("exports a board into exports/, twice without overwriting", async () => {
    const first = await post<BoardExport>("/api/boards/export", { boardId: "support" });
    expect(first.status).toBe(200);
    expect(first.body.file).toBe("support-desk.mcbot.json");
    expect(first.body.path).toBe(join(workspace, "exports", "support-desk.mcbot.json"));
    const text = readFileSync(first.body.path!, "utf8");
    expect(text).toBe(exportText(first.body.graph));
    expect(JSON.parse(text)).toMatchObject({ schema: GRAPH_SCHEMA, name: "Support desk", edges: [{ id: "edge-1" }] });
    expect(text).toContain('"apiKeyEnv": "CLOUD_KEY"'); // the key's name, never a value
    const second = await post<BoardExport>("/api/boards/export", { boardId: "support" });
    expect(second.body.file).toBe("support-desk-2.mcbot.json");
  });

  it("imports a board file as a new board and leaves the original alone", async () => {
    const exported = JSON.parse(readFileSync(join(workspace, "exports", "support-desk.mcbot.json"), "utf8"));
    const res = await post<BoardInfo>("/api/boards/import", { graph: exported, fallbackName: "support-desk" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Support desk");
    expect(res.body.id).not.toBe("support");
    const copy = await engine.relay.graph(res.body.id);
    expect(copy.nodes.map((n) => n.id).sort()).toEqual(["agent-1", "model-1"]);
    expect(copy.edges).toHaveLength(1);
    expect((await engine.relay.graph("support")).id).toBe("support");
  });

  it("names an unnamed board after its file, and refuses files that are not boards", async () => {
    const unnamed = await post<BoardInfo>("/api/boards/import", { graph: { ...board, name: "" }, fallbackName: "Q1 launch" });
    expect(unnamed.body.name).toBe("Q1 launch");
    const wrong = await post<{ error: string }>("/api/boards/import", { graph: { hello: "world" } });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toBe("This file isn't a McBot board.");
    const future = await post<{ error: string }>("/api/boards/import", { graph: { ...board, schema: "mcbot.graph/v2" } });
    expect(future.status).toBe(400);
  });
});
