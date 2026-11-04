/**
 * Contract 3 of 3 — the run event shape (docs/BUILD.md §2.2.3).
 *
 * One JSON object per line in <workspace>/runs/<runId>.jsonl, and the same
 * objects on the engine's live event stream. Events are produced by the engine
 * from two sources only:
 *   - the Hermes process it spawned (exit code, stderr), and
 *   - `hermes chat --format stream-json` records on its stdout
 *     (system/init, text, tool_use, tool_result, result — see docs/HERMES.md).
 * After a run the engine reads that session's row from the profile's state.db
 * and emits `run.cost`.
 */
import { z } from "zod";

export const RUN_EVENT_VERSION = 1;

export const TokensSchema = z.object({
  input: z.number().int().min(0),
  output: z.number().int().min(0),
  total: z.number().int().min(0),
  cacheRead: z.number().int().min(0),
  cacheWrite: z.number().int().min(0),
});
export type Tokens = z.infer<typeof TokensSchema>;

export const RunStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "interrupted"]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

const base = {
  v: z.literal(RUN_EVENT_VERSION),
  runId: z.string().min(1),
  /** 0-based, strictly increasing within a run. */
  seq: z.number().int().min(0),
  /** Unix epoch milliseconds. */
  ts: z.number().int(),
};

export const RunEventSchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("run.started"),
    boardId: z.string(),
    agentNodeId: z.string(),
    profile: z.string(),
    prompt: z.string(),
    /** argv after the hermes executable, for reproducibility. */
    argv: z.array(z.string()),
    hermesHome: z.string(),
    cwd: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal("run.session"),
    sessionId: z.string(),
    model: z.string(),
  }),
  z.object({ ...base, type: z.literal("run.text"), text: z.string() }),
  z.object({
    ...base,
    type: z.literal("run.tool.started"),
    tool: z.string(),
    input: z.unknown().optional(),
    /** Tool node whose MCP server owns this tool (mcp_<server>_<tool>), if any. */
    toolNodeId: z.string().nullable(),
  }),
  z.object({
    ...base,
    type: z.literal("run.tool.finished"),
    tool: z.string(),
    output: z.string(),
    durationMs: z.number().min(0),
    isError: z.boolean(),
    toolNodeId: z.string().nullable(),
  }),
  z.object({ ...base, type: z.literal("run.log"), stream: z.enum(["stderr", "stdout"]), line: z.string() }),
  z.object({
    ...base,
    type: z.literal("run.finished"),
    status: z.enum(["succeeded", "failed", "interrupted"]),
    exitCode: z.number().int().nullable(),
    text: z.string(),
    tokens: TokensSchema.nullable(),
    durationMs: z.number().min(0),
    sessionId: z.string().nullable(),
    error: z.string().nullable(),
  }),
  z.object({
    ...base,
    type: z.literal("run.cost"),
    sessionId: z.string(),
    model: z.string().nullable(),
    provider: z.string().nullable(),
    /** sessions.estimated_cost_usd from the profile's state.db (null = Hermes had no price). */
    reportedUsd: z.number().nullable(),
    /** sessions.cost_status, verbatim. */
    costStatus: z.string().nullable(),
    /** McBot estimate from the model node's pricing (null = no pricing set). */
    estimatedUsd: z.number().nullable(),
  }),
]);
export type RunEvent = z.infer<typeof RunEventSchema>;
export type RunEventType = RunEvent["type"];

/** Distributive Omit so each union member keeps its own fields. */
export type RunEventInput = RunEvent extends infer E
  ? E extends RunEvent
    ? Omit<E, "v" | "runId" | "seq" | "ts">
    : never
  : never;

/** A run folded from its events — what the Workflows/Agents/Cost tabs read. */
export interface RunSummary {
  runId: string;
  boardId: string;
  agentNodeId: string;
  profile: string;
  prompt: string;
  status: RunStatus;
  startedAt: number;
  finishedAt: number | null;
  sessionId: string | null;
  model: string | null;
  text: string;
  tokens: Tokens | null;
  toolCalls: number;
  toolErrors: number;
  error: string | null;
  reportedUsd: number | null;
  estimatedUsd: number | null;
}

export function summarizeRun(events: readonly RunEvent[]): RunSummary | null {
  const start = events.find((e) => e.type === "run.started");
  if (!start || start.type !== "run.started") return null;
  const s: RunSummary = {
    runId: start.runId,
    boardId: start.boardId,
    agentNodeId: start.agentNodeId,
    profile: start.profile,
    prompt: start.prompt,
    status: "running",
    startedAt: start.ts,
    finishedAt: null,
    sessionId: null,
    model: null,
    text: "",
    tokens: null,
    toolCalls: 0,
    toolErrors: 0,
    error: null,
    reportedUsd: null,
    estimatedUsd: null,
  };
  for (const e of events) {
    switch (e.type) {
      case "run.session":
        s.sessionId = e.sessionId;
        s.model = e.model;
        break;
      case "run.text":
        s.text += e.text;
        break;
      case "run.tool.started":
        s.toolCalls += 1;
        break;
      case "run.tool.finished":
        if (e.isError) s.toolErrors += 1;
        break;
      case "run.finished":
        s.status = e.status;
        s.finishedAt = e.ts;
        s.text = e.text || s.text;
        s.tokens = e.tokens;
        s.error = e.error;
        s.sessionId = e.sessionId ?? s.sessionId;
        break;
      case "run.cost":
        s.reportedUsd = e.reportedUsd;
        s.estimatedUsd = e.estimatedUsd;
        s.model = s.model ?? e.model;
        break;
      default:
        break;
    }
  }
  return s;
}
