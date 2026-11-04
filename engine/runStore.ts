/**
 * Run events on disk: <workspace>/runs/<runId>.jsonl, one RunEvent per line,
 * appended in seq order. Also the in-process fan-out to live subscribers.
 */
import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { RUN_EVENT_VERSION, RunEventSchema, summarizeRun, type RunEvent, type RunEventInput, type RunSummary } from "../src/contracts/run";

export type Listener = (e: RunEvent) => void;

export function newRunId(now = Date.now()): string {
  return `run_${now.toString(36)}_${randomBytes(4).toString("hex")}`;
}

export class RunStore {
  private readonly listeners = new Set<Listener>();
  private readonly seq = new Map<string, number>();
  private readonly cache = new Map<string, RunEvent[]>();
  private chain: Promise<void> = Promise.resolve();

  constructor(readonly dir: string) {}

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Stamp, persist (serialized, so lines stay in seq order) and broadcast one event. */
  emit(runId: string, input: RunEventInput, now = Date.now()): RunEvent {
    const seq = this.seq.get(runId) ?? 0;
    this.seq.set(runId, seq + 1);
    const event = RunEventSchema.parse({ ...input, v: RUN_EVENT_VERSION, runId, seq, ts: now });
    const list = this.cache.get(runId) ?? [];
    list.push(event);
    this.cache.set(runId, list);
    const line = `${JSON.stringify(event)}\n`;
    this.chain = this.chain.then(async () => {
      await mkdir(this.dir, { recursive: true });
      await appendFile(join(this.dir, `${runId}.jsonl`), line);
    });
    for (const fn of this.listeners) fn(event);
    return event;
  }

  /** Resolves once every emitted event is on disk. */
  flush(): Promise<void> {
    return this.chain;
  }

  async events(runId: string): Promise<RunEvent[]> {
    const cached = this.cache.get(runId);
    if (cached) return cached;
    if (!/^run_[a-z0-9]+_[a-f0-9]+$/.test(runId)) return [];
    try {
      const raw = await readFile(join(this.dir, `${runId}.jsonl`), "utf8");
      const events = raw.split("\n").filter(Boolean).flatMap((l) => {
        const parsed = RunEventSchema.safeParse(JSON.parse(l));
        return parsed.success ? [parsed.data] : [];
      });
      this.cache.set(runId, events);
      return events;
    } catch {
      return [];
    }
  }

  async list(boardId?: string): Promise<RunSummary[]> {
    let files: string[] = [];
    try {
      files = (await readdir(this.dir)).filter((f) => f.endsWith(".jsonl"));
    } catch {
      return [];
    }
    const out: RunSummary[] = [];
    for (const f of files) {
      const s = summarizeRun(await this.events(f.replace(/\.jsonl$/, "")));
      if (s && (!boardId || s.boardId === boardId)) out.push(s);
    }
    return out.sort((a, b) => b.startedAt - a.startedAt);
  }
}
