/**
 * Engine HTTP API response shapes (internal to McBot, not one of the three
 * contracts). Shared by engine/ and the UI.
 */
import type { CompileReport } from "./compile";
import type { Graph } from "./graph";

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

/** "Report a problem": plain text the person copies into an issue; saved keys and the home folder hidden. */
export interface Diagnostics {
  text: string;
}

export interface BoardInfo {
  id: string;
  name: string;
}

/** A board saved as a file: where it went (null in the browser demo, which downloads it instead). */
export interface BoardExport {
  file: string;
  path: string | null;
  /** The path to show: the home folder as ~. */
  shown: string | null;
  graph: Graph;
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

/** One agent's spend today (UTC) against its daily budget. Only agents with a budget are listed. */
export interface BudgetStatus {
  profile: string;
  agentNodeId: string | null;
  limitUsd: number;
  spentTodayUsd: number;
  /** ok < 80%, warn from 80%, over from 100% of the limit. */
  state: "ok" | "warn" | "over";
  /** Some of today's sessions had no price, so the spend shown may be too low. */
  unpriced: boolean;
}

export interface CostReport {
  totals: { sessions: number; inputTokens: number; outputTokens: number; usd: number; runs: number; successfulRuns: number };
  /** Spend of McBot-launched runs ÷ successful ones; null when none succeeded. */
  costPerSuccessfulRun: number | null;
  /** Wall-clock seconds of McBot runs on local endpoints. Hermes does not report GPU time. */
  localInferenceSeconds: number;
  budgets: BudgetStatus[];
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

/** The folder picker: the folders inside one folder (names only, never files), host only. */
export interface FsBrowse {
  path: string;
  /** null at the top of the disk. */
  parent: string | null;
  dirs: { name: string; path: string }[];
  /** Home, Desktop, Documents, Downloads and the like that exist on this computer. */
  places: { name: string; path: string }[];
}

export interface FsPreview {
  path: string;
  bytes: number;
  text: string | null;
  reason?: string;
  /** sha256 of `text`: send it back to save (the code editor). */
  sha256?: string;
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

// ---- tasks: Hermes' kanban (engine/kanban.ts) ----

/** Hermes' columns in its own order (hermes_cli/kanban_workflow.py DEFAULT_WORKFLOW), then archived. */
export const TASK_STATUSES = ["triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done", "archived"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface TaskView {
  id: string;
  title: string;
  body: string;
  /** The Hermes profile it is assigned to; null = nobody yet. */
  assignee: string | null;
  /** That profile's agent on this board, when it has one. */
  agentNodeId: string | null;
  status: TaskStatus;
  priority: number;
  /** A profile, or the person who created it in McBot. */
  createdBy: string | null;
  /** Unix ms. */
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  /** What came of it: the task's result, else its latest attempt's summary. */
  result: string | null;
  /** The latest failure Hermes recorded. */
  error: string | null;
  /** Tasks this one waits for, and tasks that wait for it. */
  parents: string[];
  children: string[];
  comments: number;
}

export interface TaskComment {
  id: number;
  author: string;
  body: string;
  at: number;
}

/** One attempt: each time the dispatcher hands the task to its agent (task_runs). */
export interface TaskAttempt {
  id: number;
  profile: string | null;
  status: string;
  outcome: string | null;
  summary: string | null;
  error: string | null;
  startedAt: number;
  endedAt: number | null;
}

export interface TaskDetail extends TaskView {
  thread: TaskComment[];
  attempts: TaskAttempt[];
}

/** One of Hermes' official optional skills (hermes/optional-skills), installable per agent. */
export interface LibrarySkill {
  /** What `hermes skills install` takes: `official/<category>/<name>`. */
  id: string;
  name: string;
  category: string;
  description: string;
  tags: string[];
}

/** GET /api/skills: the library, and for one agent what Hermes keeps in its category folders. */
export interface SkillsView {
  library: LibrarySkill[];
  installed: string[];
  /** Hermes' bundled skills are seeded into this agent. */
  seeded: boolean;
}

export interface TasksView {
  tasks: TaskView[];
  /** Tasks only start while the gateway runs: its dispatcher hands ready tasks to their agents. */
  gateway: boolean;
}

/** What a person can do to a task (each is one `hermes kanban` command). */
export type TaskAction =
  | { action: "comment"; text: string }
  | { action: "assign"; profile: string | null }
  | { action: "complete"; text?: string }
  | { action: "block"; text?: string }
  | { action: "unblock" }
  | { action: "changes"; text: string }
  | { action: "archive" };

// ---- schedules: Hermes' cron jobs, per agent (engine/schedules.ts) ----

export interface ScheduleView {
  id: string;
  name: string;
  prompt: string;
  /** As Hermes shows it: '0 9 * * 1-5', 'every 2h', … */
  when: string;
  enabled: boolean;
  state: string;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastStatus: string | null;
  lastError: string | null;
}

export interface AgentSchedules {
  agentNodeId: string;
  profile: string;
  schedules: ScheduleView[];
}

// ---- share on your network (engine/sharing.ts) ----

export interface SharingView {
  on: boolean;
  /** Where teammates reach this computer: LAN address:port. */
  addresses: string[];
  port: number;
  members: { id: string; name: string; joinedAt: number; lastSeen: number }[];
  invite: { code: string; expiresAt: number } | null;
  /** The invite as a link teammates open or paste into Join (`http://<address>/join?code=…`). */
  link?: string | null;
}
