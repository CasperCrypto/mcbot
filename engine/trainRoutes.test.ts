/**
 * Training in the cloud through the engine: the refusals people meet first, and a running job's state
 * asked of the provider (a fake OpenAI-compatible server here). No Hermes needed.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TrainJob } from "../src/contracts/api";
import { GRAPH_SCHEMA, type Graph } from "../src/contracts/graph";
import { startEngine, type Engine } from "./server";

const ORIGIN = "http://localhost:5173";

describe("training routes", () => {
  let engine: Engine;
  let provider: Server;
  let providerUrl: string;
  let workspace: string;
  const asked: string[] = [];
  const api = async <T>(path: string, body?: unknown): Promise<{ status: number; body: T }> => {
    const res = await fetch(`${engine.url}${path}`, { method: body === undefined ? "GET" : "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as T };
  };

  beforeAll(async () => {
    provider = createServer((req, res) => {
      asked.push(`${req.method} ${req.url} ${req.headers.authorization ?? ""}`);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "ftjob-1", status: "succeeded", fine_tuned_model: "ft:base-mini:me::abc" }));
    });
    await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
    providerUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`;
    workspace = mkdtempSync(join(tmpdir(), "mcbot-train-"));
    engine = await startEngine({ workspace, hermesHome: join(workspace, "hermes"), managedRoot: false, port: 0, host: "127.0.0.1", allowedOrigins: [ORIGIN] });
    const graph = {
      schema: GRAPH_SCHEMA, id: "shop", name: "Shop",
      nodes: [
        { id: "n-writer", kind: "agent", position: { x: 0, y: 0 }, data: { name: "writer", displayName: "Writer", description: "", soul: "", skills: [], capabilities: null } },
        { id: "n-cloud", kind: "model", position: { x: 0, y: 0 }, data: { name: "cloud", label: "Example", endpoint: "cloud", baseUrl: providerUrl, model: "base-mini", apiKeyEnv: "EXAMPLE_API_KEY", pricing: null } },
        { id: "n-local", kind: "model", position: { x: 0, y: 0 }, data: { name: "local", label: "Local", endpoint: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3:8b", apiKeyEnv: "", pricing: null } },
      ],
      edges: [{ id: "e1", source: "n-cloud", target: "n-writer", order: 0 }, { id: "e2", source: "n-local", target: "n-writer", order: 1 }],
    } as unknown as Graph;
    await engine.relay.create("shop", "Shop", graph);
  });
  afterAll(async () => {
    await engine?.close();
    await new Promise((r) => provider.close(r));
  });

  it("says what is missing before anything leaves this computer", async () => {
    const start = (modelNodeId: string) => api<{ error: string }>("/api/train", { boardId: "shop", agentNodeId: "n-writer", modelNodeId, baseModel: "base-mini" });
    expect((await start("n-local")).body.error).toBe("Pick one of the board's cloud models to train with");
    expect((await start("n-cloud")).body.error).toBe("Save EXAMPLE_API_KEY in Settings → API keys first");
    expect((await api("/api/secrets", { name: "EXAMPLE_API_KEY", value: "sk-example" })).status).toBe(200);
    const few = await start("n-cloud");
    expect(few.status).toBe(409);
    expect(few.body.error).toBe("Fine-tuning needs at least 10 good conversations; Writer has 0. Rate answers in Chat or add checks");
    expect(asked).toEqual([]);
  });

  it("asks the provider how a running job is doing and keeps what it made", async () => {
    const job: TrainJob = {
      id: "train_1", boardId: "shop", agentNodeId: "n-writer", profile: "writer", provider: "Example", baseUrl: providerUrl, keyEnv: "EXAMPLE_API_KEY",
      baseModel: "base-mini", model: null, remoteId: "ftjob-1", status: "running", error: null, examples: 12, dataset: "writer.jsonl", createdAt: 1, updatedAt: 1,
    };
    writeFileSync(join(workspace, "training.json"), JSON.stringify([job]));
    const { body } = await api<TrainJob[]>("/api/train?boardId=shop");
    expect(body).toMatchObject([{ id: "train_1", status: "succeeded", model: "ft:base-mini:me::abc" }]);
    expect(asked).toEqual(["GET /v1/fine_tuning/jobs/ftjob-1 Bearer sk-example"]);
  });
});
