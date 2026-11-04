/**
 * Engine HTTP API response shapes (internal to McBot, not one of the three
 * contracts). Shared by engine/ and the UI.
 */
import type { CompileReport } from "./compile";

export interface Health {
  ok: true;
  version: string;
  workspace: string;
  hermesHome: string;
  /** True when the output root is McBot's own (so the engine may restart its gateway). */
  managedRoot: boolean;
  hermes: { found: boolean; path: string | null };
}

export interface BoardInfo {
  id: string;
  name: string;
}

export interface IssueView {
  level: "error" | "warning";
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export type CompileResponse =
  | { ok: true; report: CompileReport; issues: IssueView[]; gateway: "restart-pending" | "unchanged" }
  | { ok: false; issues: IssueView[]; error: string };

export interface MemoryFileView {
  target: "memory" | "user";
  path: string;
  exists: boolean;
  entries: string[];
  chars: number;
  limit: number;
  sha256: string | null;
}

export interface AgentMemoryView {
  profile: string;
  nodeId: string;
  displayName: string;
  compiled: boolean;
  busy: boolean;
  memory: MemoryFileView;
  user: MemoryFileView;
}

export type CostSource = "hermes" | "estimate" | "none";

export interface CostRow {
  key: string;
  label: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  usd: number;
  /** Where `usd` came from: every session priced by Hermes, any estimated, or none priced. */
  source: CostSource;
}

export interface CostSession {
  id: string;
  profile: string;
  agentNodeId: string | null;
  model: string | null;
  baseUrl: string | null;
  startedAt: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  usd: number;
  source: CostSource;
  costStatus: string | null;
  runId: string | null;
  runStatus: string | null;
}

export interface CostReport {
  totals: { sessions: number; inputTokens: number; outputTokens: number; usd: number; runs: number; successfulRuns: number };
  /** Spend of McBot-launched runs ÷ successful ones; null when none succeeded. */
  costPerSuccessfulRun: number | null;
  /** Wall-clock seconds of McBot runs on local endpoints. Hermes does not report GPU time. */
  localInferenceSeconds: number;
  byAgent: CostRow[];
  byModel: CostRow[];
  byDay: CostRow[];
  sessions: CostSession[];
}

export interface FileEntry {
  path: string;
  kind: "file" | "dir";
  bytes: number;
  /** McBot owns it (listed in the manifest) vs written by Hermes at runtime. */
  owner: "mcbot" | "hermes";
}

export interface LastCompile {
  report: CompileReport | null;
}
