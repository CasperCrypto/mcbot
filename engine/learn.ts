/**
 * Learn from your work, the engine's side (src/harness/learn.ts is the pure part): the person's
 * ratings of answers (<workspace>/ratings.json), each agent's numbers for the Learn view, and the
 * datasets it writes into <workspace>/datasets/ (never over an earlier file). Exports leave out
 * every saved key value and token-shaped string (`redact`, as Report a problem does).
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentBundle } from "../src/compile/validate";
import type { RunEvent, RunSummary } from "../src/contracts/run";
import { RatingSchema, agentStats, conversationsOf, datasetLines, rewardOf, toolsUsed, type AgentLearnStats, type ConversationInput, type DatasetFormat, type DatasetPick, type Rating } from "../src/harness/learn";
import { redact } from "./diagnostics";
import { atomicWrite } from "./fsutil";

export class Ratings {
  private cache: Record<string, Rating> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}

  async all(): Promise<Record<string, Rating>> {
    if (this.cache) return this.cache;
    try {
      const raw = JSON.parse(await readFile(this.file, "utf8")) as { runs?: Record<string, unknown> };
      const out: Record<string, Rating> = {};
      for (const [id, r] of Object.entries(raw.runs ?? {})) {
        const ok = RatingSchema.safeParse(r);
        if (ok.success) out[id] = ok.data;
      }
      this.cache = out;
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  /** Rate a run (null takes the rating off). Saved one after another, so two quick clicks both land. */
  set(runId: string, rating: Rating | null): Promise<Record<string, Rating>> {
    const next = this.chain.then(async () => {
      const all = { ...(await this.all()) };
      if (rating) all[runId] = rating;
      else delete all[runId];
      this.cache = all;
      await atomicWrite(this.file, `${JSON.stringify({ v: 1, runs: all }, null, 1)}\n`);
      return all;
    });
    this.chain = next.catch(() => undefined);
    return next;
  }
}

export interface LearnAgent extends AgentLearnStats {
  agentNodeId: string;
  profile: string;
  name: string;
  checks: number;
}

/** Every agent's conversations with the rewards of their runs. */
export async function agentConversations(
  bundle: AgentBundle,
  runs: readonly RunSummary[],
  ratings: Readonly<Record<string, Rating>>,
  events: (runId: string) => Promise<RunEvent[]>,
): Promise<ConversationInput[]> {
  const mine = runs.filter((r) => r.agentNodeId === bundle.agent.id);
  const checks = bundle.agent.data.checks ?? [];
  const evs: Record<string, RunEvent[]> = {};
  const rewards: Record<string, number | null> = {};
  for (const r of mine) {
    evs[r.runId] = await events(r.runId);
    rewards[r.runId] = rewardOf(r, ratings[r.runId], checks, toolsUsed(evs[r.runId]!));
  }
  return conversationsOf(mine).map((c) => ({ runs: c, events: evs, rewards }));
}

export function learnAgent(bundle: AgentBundle, convs: readonly ConversationInput[], ratings: Readonly<Record<string, Rating>>): LearnAgent {
  const a = bundle.agent.data;
  return { agentNodeId: bundle.agent.id, profile: a.name, name: a.displayName || a.name, checks: a.checks?.length ?? 0, ...agentStats(convs, ratings) };
}

const stamp = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;

/** Write the dataset; returns where, and how many conversations went in. */
export async function writeDataset(dir: string, opts: {
  profile: string;
  convs: readonly ConversationInput[];
  format: DatasetFormat;
  pick: DatasetPick;
  system: string;
  model: string | null;
  secrets: readonly string[];
  now?: Date;
}): Promise<{ path: string; shown: string; file: string; examples: number }> {
  const now = opts.now ?? new Date();
  const { lines } = datasetLines(opts.convs, { format: opts.format, pick: opts.pick, system: opts.system, model: opts.model, at: now.toISOString() });
  // Keys and token-shaped strings never leave in a dataset (the run text may quote them).
  const text = lines.map((l) => redact(l, [...opts.secrets])).join("\n");
  await mkdir(dir, { recursive: true });
  const base = `${opts.profile}-${opts.format}-${stamp(now)}`;
  for (let n = 1; ; n++) {
    const file = `${base}${n > 1 ? `-${n}` : ""}.jsonl`;
    const path = join(dir, file);
    if (existsSync(path)) continue;
    try {
      await writeFile(path, text ? `${text}\n` : "", { flag: "wx", mode: 0o600 });
      const home = homedir();
      return { path, file, shown: home.length > 1 && path.startsWith(home) ? `~${path.slice(home.length)}` : path, examples: lines.length };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
}
