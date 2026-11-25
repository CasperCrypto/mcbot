import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TrainStore, cancelFineTune, readFineTune, startFineTune, trainStatus, trainSuffix, type TrainJob } from "./train";

/** A fake OpenAI-compatible provider: records requests, answers from a table. */
function provider(answers: Record<string, { status: number; body: unknown }>) {
  const seen: { method: string; url: string; auth: string | null; body: unknown }[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    const body = init?.body instanceof FormData ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : `file:${(v as File).name}`])) : init?.body ? JSON.parse(String(init.body)) : null;
    seen.push({ method, url: u, auth: new Headers(init?.headers).get("authorization"), body });
    const hit = answers[`${method} ${u}`] ?? { status: 404, body: { error: { message: "no route" } } };
    return new Response(JSON.stringify(hit.body), { status: hit.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, seen };
}

const B = "https://api.example.com/v1";
const job = { baseUrl: `${B}/`, key: "sk-test", provider: "Example", jsonl: '{"messages":[]}\n', fileName: "writer-chat.jsonl", model: "base-mini", suffix: "mcbot-writer" };

describe("training in the cloud", () => {
  it("uploads the dataset, then starts the job with it", async () => {
    const { f, seen } = provider({
      [`POST ${B}/files`]: { status: 200, body: { id: "file-1" } },
      [`POST ${B}/fine_tuning/jobs`]: { status: 200, body: { id: "ftjob-1", status: "validating_files" } },
    });
    expect(await startFineTune(f, job)).toEqual({ remoteId: "ftjob-1", status: "validating" });
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([`POST ${B}/files`, `POST ${B}/fine_tuning/jobs`]);
    expect(seen[0]).toMatchObject({ auth: "Bearer sk-test", body: { purpose: "fine-tune", file: "file:writer-chat.jsonl" } });
    expect(seen[1]!.body).toEqual({ training_file: "file-1", model: "base-mini", suffix: "mcbot-writer" });
  });

  it("says plainly when the provider has no fine-tuning, or refuses the key or the model", async () => {
    await expect(startFineTune(provider({}).f, job)).rejects.toThrow("Example doesn't take fine-tuning jobs through the OpenAI API");
    await expect(startFineTune(provider({ [`POST ${B}/files`]: { status: 401, body: {} } }).f, job)).rejects.toThrow("Example refused the key (401)");
    await expect(startFineTune(provider({
      [`POST ${B}/files`]: { status: 200, body: { id: "file-1" } },
      [`POST ${B}/fine_tuning/jobs`]: { status: 400, body: { error: { message: "Model base-mini is not available for fine-tuning" } } },
    }).f, job)).rejects.toThrow("Example refused the job: Model base-mini is not available for fine-tuning");
  });

  it("reads where a job is, with the model it made or why it failed, and cancels it", async () => {
    const { f, seen } = provider({
      [`GET ${B}/fine_tuning/jobs/ftjob-1`]: { status: 200, body: { status: "succeeded", fine_tuned_model: "ft:base-mini:me::abc" } },
      [`GET ${B}/fine_tuning/jobs/ftjob-2`]: { status: 200, body: { status: "failed", error: { message: "Too few examples" } } },
      [`POST ${B}/fine_tuning/jobs/ftjob-3/cancel`]: { status: 200, body: {} },
    });
    expect(await readFineTune(f, { baseUrl: B, key: "k", remoteId: "ftjob-1" })).toEqual({ status: "succeeded", model: "ft:base-mini:me::abc", error: null });
    expect(await readFineTune(f, { baseUrl: B, key: "k", remoteId: "ftjob-2" })).toEqual({ status: "failed", model: null, error: "Too few examples" });
    await cancelFineTune(f, { baseUrl: B, key: "k", remoteId: "ftjob-3" });
    expect(seen.at(-1)).toMatchObject({ method: "POST", url: `${B}/fine_tuning/jobs/ftjob-3/cancel` });
  });

  it("names states and suffixes the way people read them", () => {
    expect(["validating_files", "queued", "running", "succeeded", "failed", "cancelled", "weird"].map(trainStatus)).toEqual(["validating", "queued", "running", "succeeded", "failed", "cancelled", "failed"]);
    expect(trainSuffix("Writer_2")).toBe("mcbot-writer-2");
  });

  it("keeps every job, newest first", async () => {
    const store = new TrainStore(join(mkdtempSync(join(tmpdir(), "train-")), "training.json"));
    const j = (id: string, at: number): TrainJob => ({ id, boardId: "b", agentNodeId: "a", profile: "writer", provider: "Example", baseUrl: B, keyEnv: "K", baseModel: "m", model: null, remoteId: "r", status: "queued", error: null, examples: 12, dataset: "d.jsonl", createdAt: at, updatedAt: at });
    await store.put(j("old", 1));
    await store.put(j("new", 2));
    await store.put({ ...j("old", 1), status: "succeeded" });
    expect((await store.all()).map((x) => [x.id, x.status])).toEqual([["new", "queued"], ["old", "succeeded"]]);
  });
});
