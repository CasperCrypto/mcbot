/**
 * Learn from your work: an agent's runs as training data, and how good each one was.
 *
 * Every run McBot starts is already recorded as events (the prompt, each tool the agent used with
 * its input and result, the answer). Here they become conversations (runs of one Hermes session,
 * in order) in the formats training tools read:
 *   - "chat":     OpenAI chat fine-tuning JSONL, `{"messages": [...]}` with `tool_calls` and tool
 *                 results; OpenAI and Together fine-tuning, Unsloth, Hugging Face TRL and MLX-LM read it.
 *   - "rewards":  the same, each with a `reward` from 0 to 1, for filtering, preference or RL training.
 *   - "sharegpt": Hermes' own trajectory format (agent/trajectory.py `save_trajectory`: `conversations`
 *                 of from/value turns, `<tool_call>` / `<tool_response>` blocks; agent_runtime_helpers.py
 *                 `convert_to_trajectory_format`), which Nous' trajectory and RL tooling reads.
 * A run's reward is the person's rating (thumbs up 1, down 0) when there is one; else the share of
 * the agent's checks its answer passes; a failed or stopped run is 0; else unknown. Pure: no
 * network, no filesystem (the engine reads runs and writes files; the demo downloads).
 */
import { z } from "zod";
import { CHECK_KINDS, CheckSchema, type Check } from "../contracts/graph";
import type { RunEvent, RunSummary } from "../contracts/run";

export { CHECK_KINDS, CheckSchema, type Check };
export type CheckKind = (typeof CHECK_KINDS)[number];

/** What each kind checks, in words (the Learn view shows these). */
export const CHECK_LABELS: Record<CheckKind, { label: string; placeholder: string }> = {
  includes: { label: "Mentions", placeholder: "price, delivery date" },
  excludes: { label: "Never mentions", placeholder: "guarantee, competitor names" },
  usedTool: { label: "Used the tool", placeholder: "image_generate" },
  minWords: { label: "At least words", placeholder: "50" },
  maxWords: { label: "At most words", placeholder: "120" },
  json: { label: "Answers with valid JSON", placeholder: "" },
};

export const RatingSchema = z.object({
  score: z.union([z.literal(0), z.literal(1)]),
  note: z.string().max(500).optional(),
  by: z.string().max(80).optional(),
  at: z.number(),
});
export type Rating = z.infer<typeof RatingSchema>;

const phrases = (v: string) => v.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

/** Whether an answer (its text, and the tools used on the way) passes one check. */
export function passes(check: Check, answer: { text: string; tools: readonly string[] }): boolean {
  const text = answer.text.toLowerCase();
  switch (check.kind) {
    case "includes": return phrases(check.value).every((p) => text.includes(p));
    case "excludes": return !phrases(check.value).some((p) => text.includes(p));
    case "usedTool": {
      const want = check.value.trim().toLowerCase();
      return !!want && answer.tools.some((t) => t.toLowerCase().includes(want));
    }
    case "minWords": { const n = parseInt(check.value, 10); return !Number.isFinite(n) || words(answer.text) >= n; }
    case "maxWords": { const n = parseInt(check.value, 10); return !Number.isFinite(n) || words(answer.text) <= n; }
    case "json": {
      const fenced = /```(?:json)?\s*\n([\s\S]*?)```/.exec(answer.text);
      try {
        JSON.parse((fenced ? fenced[1]! : answer.text).trim());
        return true;
      } catch {
        return false;
      }
    }
  }
}

/** The tools a run used, in order. */
export const toolsUsed = (events: readonly RunEvent[]): string[] => events.flatMap((e) => (e.type === "run.tool.started" ? [e.tool] : []));

/** A run's reward from 0 to 1 (see the header), or null when nothing says how it went. */
export function rewardOf(run: Pick<RunSummary, "status" | "text">, rating: Rating | null | undefined, checks: readonly Check[], tools: readonly string[] = []): number | null {
  if (rating) return rating.score;
  if (run.status === "failed" || run.status === "interrupted") return 0;
  if (run.status !== "succeeded" || checks.length === 0) return null;
  return checks.filter((c) => passes(c, { text: run.text, tools })).length / checks.length;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

/**
 * One run as chat messages: the person's message, each round of tool calls with their results
 * (calls started together are one assistant turn), and the answer. Tool call ids are made up
 * (`call_<n>`, unique in the conversation through `start`).
 */
export function runMessages(events: readonly RunEvent[], start = 0): { messages: ChatMessage[]; next: number } {
  const started = events.find((e) => e.type === "run.started");
  if (!started || started.type !== "run.started") return { messages: [], next: start };
  const messages: ChatMessage[] = [{ role: "user", content: started.prompt }];
  let n = start;
  let open: { id: string; name: string; args: string; result: string | null }[] = [];
  let answered = false;
  const flush = () => {
    if (!open.length) return;
    messages.push({ role: "assistant", content: null, tool_calls: open.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args } })) });
    for (const c of open) messages.push({ role: "tool", tool_call_id: c.id, content: c.result ?? "" });
    open = [];
    answered = false;
  };
  let text = "";
  for (const e of events) {
    if (e.type === "run.tool.started") {
      if (answered) flush();
      const args = typeof e.input === "string" ? JSON.stringify({ input: e.input }) : JSON.stringify(e.input ?? {});
      open.push({ id: `call_${++n}`, name: e.tool, args, result: null });
    } else if (e.type === "run.tool.finished") {
      const call = open.find((c) => c.result === null && c.name === e.tool) ?? open.find((c) => c.result === null);
      if (call) call.result = e.output;
      answered = true;
    } else if (e.type === "run.text") text += e.text;
  }
  flush();
  if (text.trim()) messages.push({ role: "assistant", content: text.trim() });
  return { messages, next: n };
}

/** Runs as conversations: the runs of one Hermes session together, oldest first; a run without one alone. */
export function conversationsOf<T extends Pick<RunSummary, "runId" | "sessionId" | "startedAt">>(runs: readonly T[]): T[][] {
  const bySession = new Map<string, T[]>();
  const alone: T[][] = [];
  for (const r of [...runs].sort((a, b) => a.startedAt - b.startedAt)) {
    if (r.sessionId) bySession.set(r.sessionId, [...(bySession.get(r.sessionId) ?? []), r]);
    else alone.push([r]);
  }
  return [...bySession.values(), ...alone].sort((a, b) => a[0]!.startedAt - b[0]!.startedAt);
}

export type DatasetFormat = "chat" | "rewards" | "sharegpt";
/** Which conversations go in: only the good ones (thumbs up, or checks mostly passing), or every one that finished. */
export type DatasetPick = "good" | "all";
/** A conversation's reward at or above this counts as good. */
export const GOOD = 0.7;

export interface ConversationInput {
  runs: RunSummary[];
  events: Readonly<Record<string, readonly RunEvent[]>>;
  rewards: Readonly<Record<string, number | null>>;
}

/** The mean of the known run rewards, or null. */
export function conversationReward(runs: readonly Pick<RunSummary, "runId">[], rewards: Readonly<Record<string, number | null>>): number | null {
  const known = runs.map((r) => rewards[r.runId]).filter((x): x is number => typeof x === "number");
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
}

/** Chat messages → Hermes' from/value turns (agent_runtime_helpers.py `convert_to_trajectory_format`). */
export function toShareGpt(messages: readonly ChatMessage[]): { from: "system" | "human" | "gpt" | "tool"; value: string }[] {
  const out: { from: "system" | "human" | "gpt" | "tool"; value: string }[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role === "system") out.push({ from: "system", value: m.content ?? "" });
    else if (m.role === "user") out.push({ from: "human", value: m.content ?? "" });
    else if (m.role === "assistant" && m.tool_calls?.length) {
      const calls = m.tool_calls.map((c) => {
        let args: unknown = {};
        try { args = JSON.parse(c.function.arguments); } catch { /* keep {} as Hermes does */ }
        return `<tool_call>\n${JSON.stringify({ name: c.function.name, arguments: args })}\n</tool_call>`;
      });
      out.push({ from: "gpt", value: [...(m.content?.trim() ? [m.content.trim()] : []), ...calls].join("\n") });
      const responses: string[] = [];
      while (messages[i + 1]?.role === "tool") {
        const t = messages[++i]!;
        const name = m.tool_calls.find((c) => c.id === t.tool_call_id)?.function.name ?? "unknown";
        let content: unknown = t.content ?? "";
        if (typeof content === "string" && /^\s*[[{]/.test(content)) {
          try { content = JSON.parse(content); } catch { /* leave text */ }
        }
        responses.push(`<tool_response>\n${JSON.stringify({ tool_call_id: t.tool_call_id ?? "", name, content })}\n</tool_response>`);
      }
      if (responses.length) out.push({ from: "tool", value: responses.join("\n") });
    } else if (m.role === "assistant") out.push({ from: "gpt", value: m.content ?? "" });
  }
  return out;
}

/**
 * The dataset's JSONL lines. `system` is what the agent is told before every conversation (its
 * SOUL.md as compiled); `at` stamps the ShareGPT entries. Conversations that did not finish are
 * left out; "good" keeps only those whose reward is at least GOOD; "rewards" needs a known reward.
 */
export function datasetLines(convs: readonly ConversationInput[], opts: { format: DatasetFormat; pick: DatasetPick; system: string; model: string | null; at: string }): { lines: string[]; kept: number } {
  const lines: string[] = [];
  for (const c of convs) {
    if (!c.runs.length || c.runs.some((r) => r.status === "running" || r.status === "queued")) continue;
    const reward = conversationReward(c.runs, c.rewards);
    if (opts.pick === "good" && !(reward !== null && reward >= GOOD)) continue;
    if (opts.format === "rewards" && reward === null) continue;
    let next = 0;
    const messages: ChatMessage[] = opts.system.trim() ? [{ role: "system", content: opts.system.trim() }] : [];
    for (const r of c.runs) {
      const turn = runMessages(c.events[r.runId] ?? [], next);
      next = turn.next;
      messages.push(...turn.messages);
    }
    if (!messages.some((m) => m.role === "assistant")) continue;
    if (opts.format === "chat") lines.push(JSON.stringify({ messages }));
    else if (opts.format === "rewards") lines.push(JSON.stringify({ messages, reward: Math.round(reward! * 1000) / 1000 }));
    else lines.push(JSON.stringify({ conversations: toShareGpt(messages), timestamp: opts.at, model: opts.model ?? "", completed: c.runs.every((r) => r.status === "succeeded"), ...(reward !== null ? { reward: Math.round(reward * 1000) / 1000 } : {}) }));
  }
  return { lines, kept: lines.length };
}

/** One agent's numbers for the Learn view. */
export interface AgentLearnStats {
  conversations: number;
  up: number;
  down: number;
  /** Mean reward of the conversations that have one, or null. */
  reward: number | null;
  /** Conversations good enough to train on (reward at least GOOD). */
  good: number;
}

export function agentStats(convs: readonly ConversationInput[], ratings: Readonly<Record<string, Rating>>): AgentLearnStats {
  let up = 0;
  let down = 0;
  const rewards: number[] = [];
  for (const c of convs) {
    for (const r of c.runs) {
      const rating = ratings[r.runId];
      if (rating?.score === 1) up++;
      else if (rating?.score === 0) down++;
    }
    const reward = conversationReward(c.runs, c.rewards);
    if (reward !== null) rewards.push(reward);
  }
  return {
    conversations: convs.length,
    up, down,
    reward: rewards.length ? rewards.reduce((a, b) => a + b, 0) / rewards.length : null,
    good: rewards.filter((x) => x >= GOOD).length,
  };
}
