/**
 * Maps `hermes chat --format stream-json` stdout lines to run events
 * (contract 3). Record shapes are documented in Hermes'
 * website/docs/reference/cli-commands.md and pinned by the real captures in
 * test/fixtures/hermes-stream/. Unknown or non-JSON lines are kept as
 * run.log, never dropped.
 */
import { mcpToolPrefix } from "../src/compile/config";
import type { RunEventInput, Tokens } from "../src/contracts/run";

export interface ToolNodeRef {
  id: string;
  name: string;
}

interface HermesTokens {
  input?: number;
  output?: number;
  total?: number;
  cache_read?: number;
  cache_write?: number;
}

const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);

function tokens(t: HermesTokens | undefined): Tokens | null {
  if (!t || typeof t !== "object") return null;
  return { input: int(t.input), output: int(t.output), total: int(t.total), cacheRead: int(t.cache_read), cacheWrite: int(t.cache_write) };
}

/** Hermes' deferred-tool bridge wraps MCP calls: tool_call {name} or {calls: [{name}]}. */
function underlyingToolNames(name: string, input: unknown): string[] {
  if (name !== "tool_call" || !input || typeof input !== "object") return [name];
  const rec = input as { name?: unknown; calls?: unknown };
  const calls = Array.isArray(rec.calls) ? rec.calls : [rec];
  const names = calls.map((c) => (c && typeof c === "object" ? (c as { name?: unknown }).name : undefined)).filter((n): n is string => typeof n === "string");
  return names.length ? names : [name];
}

export function statusForExit(exitCode: number | null): "succeeded" | "failed" | "interrupted" {
  if (exitCode === 0) return "succeeded";
  if (exitCode === 130) return "interrupted";
  return "failed";
}

export class StreamMapper {
  private readonly toolNodes: ToolNodeRef[];
  private readonly calls = new Map<string, { tool: string; toolNodeId: string | null }>();
  private sessionSeen = false;
  private text = "";
  finished = false;

  constructor(toolNodes: readonly ToolNodeRef[]) {
    // Longest prefix first so "git_ops" wins over "git".
    this.toolNodes = [...toolNodes].sort((a, b) => b.name.length - a.name.length);
  }

  toolNodeFor(toolName: string): string | null {
    return this.toolNodes.find((t) => toolName.startsWith(mcpToolPrefix(t.name)))?.id ?? null;
  }

  feed(line: string): RunEventInput[] {
    const trimmed = line.trim();
    if (!trimmed) return [];
    let rec: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      rec = parsed as Record<string, unknown>;
    } catch {
      return [{ type: "run.log", stream: "stdout", line }];
    }
    switch (rec.type) {
      case "system": {
        const sessionId = typeof rec.session_id === "string" ? rec.session_id : "";
        if (!sessionId) return [];
        this.sessionSeen = true;
        return [{ type: "run.session", sessionId, model: typeof rec.model === "string" ? rec.model : "" }];
      }
      case "text": {
        const t = typeof rec.text === "string" ? rec.text : "";
        this.text += t;
        return t ? [{ type: "run.text", text: t }] : [];
      }
      case "tool_use": {
        const raw = String(rec.name ?? "tool");
        const tool = underlyingToolNames(raw, rec.input).join(", ");
        const toolNodeId = underlyingToolNames(raw, rec.input).map((n) => this.toolNodeFor(n)).find((id) => id !== null) ?? null;
        if (typeof rec.tool_call_id === "string") this.calls.set(rec.tool_call_id, { tool, toolNodeId });
        return [{ type: "run.tool.started", tool, input: rec.input, toolNodeId }];
      }
      case "tool_result": {
        const known = typeof rec.tool_call_id === "string" ? this.calls.get(rec.tool_call_id) : undefined;
        const tool = known?.tool ?? String(rec.name ?? "tool");
        return [{
          type: "run.tool.finished",
          tool,
          output: typeof rec.output === "string" ? rec.output : JSON.stringify(rec.output ?? ""),
          durationMs: int(rec.duration_ms),
          isError: rec.is_error === true,
          toolNodeId: known?.toolNodeId ?? this.toolNodeFor(tool),
        }];
      }
      case "result": {
        this.finished = true;
        const exitCode = typeof rec.exit_code === "number" ? rec.exit_code : null;
        const sessionId = typeof rec.session_id === "string" && rec.session_id ? rec.session_id : null;
        const out: RunEventInput[] = [];
        if (sessionId && !this.sessionSeen) {
          this.sessionSeen = true;
          out.push({ type: "run.session", sessionId, model: "" });
        }
        out.push({
          type: "run.finished",
          status: statusForExit(exitCode),
          exitCode,
          text: typeof rec.text === "string" ? rec.text : this.text,
          tokens: tokens(rec.tokens as HermesTokens | undefined),
          durationMs: int(rec.duration_ms),
          sessionId,
          error: typeof rec.error === "string" && rec.error ? rec.error : null,
        });
        return out;
      }
      default:
        return [{ type: "run.log", stream: "stdout", line }];
    }
  }

  /** Called when the process exits. Emits run.finished only if Hermes never sent `result`. */
  finish(exitCode: number | null, signal: string | null, durationMs: number, stderrTail: readonly string[]): RunEventInput | null {
    if (this.finished) return null;
    this.finished = true;
    const interrupted = signal === "SIGINT" || exitCode === 130;
    const detail = stderrTail.filter((l) => l.trim()).slice(-3).join(" | ");
    return {
      type: "run.finished",
      status: interrupted ? "interrupted" : "failed",
      exitCode,
      text: this.text,
      tokens: null,
      durationMs,
      sessionId: null,
      error: `hermes exited (${signal ?? `code ${exitCode}`}) without a result record${detail ? `: ${detail}` : ""}`,
    };
  }
}
