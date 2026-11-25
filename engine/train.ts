/**
 * Training in the cloud (Knowledge → Training → Train): an agent's good conversations, as OpenAI chat
 * JSONL, go to the cloud provider the board already uses, through the OpenAI fine-tuning API (no SDK:
 * plain HTTP, like every model call): `POST <base>/files` (purpose fine-tune), `POST <base>/fine_tuning/jobs`
 * {training_file, model, suffix}, `GET <base>/fine_tuning/jobs/<id>` until it ends with `fine_tuned_model`,
 * `POST …/cancel`. A provider that has no such API answers 404 and McBot says so. The job is kept in
 * `<workspace>/training.json`; the key is read here and never leaves the engine. Training on this computer
 * is an agent's task instead (the Training view gives a Trainer agent an Until-done task).
 */
import { randomBytes } from "node:crypto";
import { atomicWrite, readTextOrNull } from "./fsutil";

import type { TrainJob, TrainStatus } from "../src/contracts/api";

export type { TrainJob, TrainStatus };

/** Fine-tuning APIs refuse fewer examples than this (OpenAI's minimum). */
export const MIN_EXAMPLES = 10;

export class TrainError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

type Fetch = typeof fetch;
const ACTIVE = new Set<TrainStatus>(["validating", "queued", "running"]);
export const isActive = (j: Pick<TrainJob, "status">) => ACTIVE.has(j.status);

/** The provider's words for a job's state, as McBot's (OpenAI: validating_files, queued, running, succeeded, failed, cancelled). */
export function trainStatus(s: unknown): TrainStatus {
  switch (s) {
    case "validating_files": return "validating";
    case "queued": case "pending": return "queued";
    case "running": return "running";
    case "succeeded": return "succeeded";
    case "cancelled": return "cancelled";
    default: return "failed";
  }
}

/** A suffix for the model's name (letters, digits and dashes; the API keeps it short). */
export const trainSuffix = (profile: string) => `mcbot-${profile}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 40).replace(/-+$/, "");

const base = (url: string) => url.replace(/\/+$/, "");

async function refusal(res: Response, what: string, provider: string): Promise<TrainError> {
  if (res.status === 404 || res.status === 405) return new TrainError(409, `${provider} doesn't take fine-tuning jobs through the OpenAI API. Use one that does (OpenAI), or train on this computer`);
  if (res.status === 401 || res.status === 403) return new TrainError(409, `${provider} refused the key (${res.status}). Check it in Settings → API keys`);
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } | string; message?: string };
  const msg = typeof body.error === "string" ? body.error : body.error?.message ?? body.message;
  return new TrainError(409, `${provider} refused ${what}: ${msg ?? res.statusText}`);
}

/** Upload the dataset and start the job; resolves to the provider's job id and its first state. */
export async function startFineTune(f: Fetch, o: { baseUrl: string; key: string; provider: string; jsonl: string; fileName: string; model: string; suffix: string }): Promise<{ remoteId: string; status: TrainStatus }> {
  const auth = { authorization: `Bearer ${o.key}` };
  const form = new FormData();
  form.append("purpose", "fine-tune");
  form.append("file", new Blob([o.jsonl], { type: "application/jsonl" }), o.fileName);
  const up = await f(`${base(o.baseUrl)}/files`, { method: "POST", headers: auth, body: form });
  if (!up.ok) throw await refusal(up, "the dataset", o.provider);
  const file = (await up.json()) as { id?: string };
  if (!file.id) throw new TrainError(502, `${o.provider} took the dataset but gave no file id`);
  const res = await f(`${base(o.baseUrl)}/fine_tuning/jobs`, {
    method: "POST", headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ training_file: file.id, model: o.model, suffix: o.suffix }),
  });
  if (!res.ok) throw await refusal(res, "the job", o.provider);
  const job = (await res.json()) as { id?: string; status?: string };
  if (!job.id) throw new TrainError(502, `${o.provider} started no job`);
  return { remoteId: job.id, status: trainStatus(job.status) };
}

/** Where a job is now. */
export async function readFineTune(f: Fetch, o: { baseUrl: string; key: string; remoteId: string }): Promise<{ status: TrainStatus; model: string | null; error: string | null }> {
  const res = await f(`${base(o.baseUrl)}/fine_tuning/jobs/${encodeURIComponent(o.remoteId)}`, { headers: { authorization: `Bearer ${o.key}` } });
  if (!res.ok) throw new TrainError(502, `Couldn't ask about the job (${res.status})`);
  const j = (await res.json()) as { status?: string; fine_tuned_model?: string | null; error?: { message?: string } | null };
  const status = trainStatus(j.status);
  return { status, model: typeof j.fine_tuned_model === "string" && j.fine_tuned_model ? j.fine_tuned_model : null, error: status === "failed" ? j.error?.message ?? "The provider stopped the job" : null };
}

export async function cancelFineTune(f: Fetch, o: { baseUrl: string; key: string; remoteId: string }): Promise<void> {
  const res = await f(`${base(o.baseUrl)}/fine_tuning/jobs/${encodeURIComponent(o.remoteId)}/cancel`, { method: "POST", headers: { authorization: `Bearer ${o.key}` } });
  if (!res.ok) throw new TrainError(409, `The provider would not cancel it (${res.status})`);
}

/** <workspace>/training.json: every training job, newest first. */
export class TrainStore {
  constructor(private readonly file: string) {}

  async all(): Promise<TrainJob[]> {
    try {
      const v = JSON.parse((await readTextOrNull(this.file)) ?? "[]") as unknown;
      return Array.isArray(v) ? (v as TrainJob[]) : [];
    } catch {
      return [];
    }
  }

  async put(job: TrainJob): Promise<void> {
    const all = (await this.all()).filter((j) => j.id !== job.id);
    await atomicWrite(this.file, `${JSON.stringify([job, ...all].sort((a, b) => b.createdAt - a.createdAt), null, 2)}\n`);
  }
}

export const newTrainId = () => `train_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
