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
  hermes: { found: boolean; path: string | null; kind?: "bundled" | "external" | null };
}

/** The Hermes McBot runs agents with. */
export interface HermesInfo {
  /** "bundled": McBot's own copy (hermes/, our fork); "external": an install found elsewhere. */
  kind: "bundled" | "external" | null;
  path: string | null;
  /** hermes/UPSTREAM.json: the upstream release our fork is based on (bundled only). */
  upstream: { url: string; commit: string; date: string } | null;
  /** HERMES_HOME of McBot's agents. */
  root: string;
  managedRoot: boolean;
  gateway: { running: boolean; pid: number | null };
  /** McBot's own Hermes is present (hermes/), whether or not it is prepared yet. */
  source: boolean;
  /** Running from the installed app (not from source): there is no `npm run cli`. */
  installed: boolean;
  /** Preparing McBot's own Hermes (first launch): its tools and dependencies. */
  setup: { state: "idle" | "running" | "done" | "failed"; lines: string[] };
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

/** A browsable place in the Files graph. */
export interface FsRoot {
  /** "profile:<agent>", "workspace:files" or "folder:<hash>" */
  id: string;
  kind: "profile" | "workspace" | "folder";
  name: string;
  path: string;
  /** Agent node for profile roots. */
  nodeId?: string;
}

export interface FsEntry {
  name: string;
  /** POSIX path relative to the root. */
  path: string;
  kind: "file" | "dir";
  bytes: number;
  /** Number of children for a directory (null when unreadable or a file). */
  children: number | null;
  /** Written by the McBot compiler (listed in the manifest). */
  owned: boolean;
}

export interface FsListing {
  root: string;
  path: string;
  entries: FsEntry[];
  truncated: number;
}

export interface FsPreview {
  path: string;
  bytes: number;
  text: string | null;
  reason?: string;
}

export interface LastCompile {
  report: CompileReport | null;
}

// ---- setup assistant ----

export type SetupKind = "personal" | "team" | "company";

/** What the setup assistant was told. Goes into agents' SOUL.md and USER.md memory. */
export interface SetupProfile {
  kind: SetupKind;
  name: string;
  company: string;
  about: string;
  role: string;
}

export interface SetupState {
  completed: boolean;
  profile: SetupProfile | null;
}

/** An OpenAI-compatible model server answering on this computer. */
export interface LocalServer {
  name: string;
  baseUrl: string;
  models: string[];
}

export interface SetupDetect {
  /** source: McBot's own Hermes is present but may still need preparing. */
  hermes: { found: boolean; path: string | null; kind?: "bundled" | "external" | null; source?: boolean };
  local: LocalServer[];
  /** Names of the API keys McBot holds (never the values). */
  secrets: string[];
}
