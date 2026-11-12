/**
 * The team's tasks: Hermes' kanban. One durable board per Hermes home, shared by every profile
 * in it (hermes_cli/kanban_db.py `kanban_home`, `kanban_db_path`: the default board is
 * `<root>/kanban.db`), so the agents McBot compiles into one root hand work to each other there.
 *
 * Reads go straight to kanban.db, read-only, `SELECT *` so newer Hermes columns don't break us.
 * Every change goes through `hermes kanban …`, so Hermes keeps its own events, claims and rules.
 * A ready task starts when the root's gateway runs: its dispatcher hands it to its agent
 * (gateway/kanban_watchers.py, one tick every `kanban.dispatch_interval_seconds`, 60 by default).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { TASK_STATUSES, type TaskAction, type TaskAttempt, type TaskComment, type TaskDetail, type TaskStatus, type TaskView } from "../src/contracts/api";
import { hermesCommand, hermesEnv, type HermesBinary } from "./hermes";

type Row = Record<string, unknown>;

export const kanbanDb = (root: string) => join(root, "kanban.db");

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
/** Hermes stores Unix seconds. */
const ms = (v: unknown): number | null => (typeof v === "number" || typeof v === "bigint" ? Number(v) * 1000 : null);
const status = (v: unknown): TaskStatus => ((TASK_STATUSES as readonly string[]).includes(String(v)) ? (v as TaskStatus) : "todo");

function withDb<T>(root: string, fn: (db: DatabaseSync) => T): T | null {
  const path = kanbanDb(root);
  if (!existsSync(path)) return null;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function toView(r: Row, profiles: ReadonlyMap<string, string>, links: Row[], comments: Map<string, number>, summaries: Map<string, string>): TaskView {
  const id = String(r.id);
  const assignee = str(r.assignee);
  return {
    id,
    title: String(r.title ?? ""),
    body: String(r.body ?? ""),
    assignee,
    agentNodeId: assignee ? profiles.get(assignee) ?? null : null,
    status: status(r.status),
    priority: Number(r.priority ?? 0),
    createdBy: str(r.created_by),
    createdAt: ms(r.created_at) ?? 0,
    startedAt: ms(r.started_at),
    completedAt: ms(r.completed_at),
    result: str(r.result) ?? summaries.get(id) ?? null,
    error: str(r.last_failure_error),
    parents: links.filter((l) => l.child_id === id).map((l) => String(l.parent_id)).sort(),
    children: links.filter((l) => l.parent_id === id).map((l) => String(l.child_id)).sort(),
    comments: comments.get(id) ?? 0,
  };
}

function readAll(db: DatabaseSync, profiles: ReadonlyMap<string, string>, where = "", ...params: string[]): TaskView[] {
  const rows = db.prepare(`SELECT * FROM tasks ${where}`).all(...params) as Row[];
  const links = db.prepare("SELECT parent_id, child_id FROM task_links").all() as Row[];
  const comments = new Map((db.prepare("SELECT task_id, COUNT(*) AS n FROM task_comments GROUP BY task_id").all() as Row[]).map((r) => [String(r.task_id), Number(r.n)]));
  // The latest attempt's handoff summary (kanban_complete --summary lands on the run, not the task).
  const summaries = new Map<string, string>();
  for (const r of db.prepare("SELECT task_id, summary FROM task_runs WHERE summary IS NOT NULL AND summary != '' ORDER BY id").all() as Row[]) summaries.set(String(r.task_id), String(r.summary));
  return rows.map((r) => toView(r, profiles, links, comments, summaries));
}

/**
 * Which board a task belongs to: Hermes' `tenant` namespace (`--tenant`, kanban_parser.py; the
 * dispatcher passes it to the worker as HERMES_TENANT and subtasks inherit it, kanban_db_graph.py).
 * McBot sets `mcbot-<boardId>` on every task it creates.
 */
export const boardTenant = (boardId: string) => `mcbot-${boardId}`;

/**
 * The tasks this board's people and agents see: every task assigned to or created by one of its
 * agents, and every unassigned one, newest first. Archived tasks are left out.
 * `profiles` maps each agent's profile name to its node id on the board.
 */
export function readTasks(root: string, profiles: ReadonlyMap<string, string>, boardId?: string): TaskView[] {
  const read = withDb(root, (db) => ({
    all: readAll(db, profiles, "WHERE status != 'archived'"),
    tenants: new Map((db.prepare("SELECT * FROM tasks").all() as Row[]).map((r) => [String(r.id), r.tenant == null ? null : String(r.tenant)])),
  }));
  const mine = boardId ? boardTenant(boardId) : null;
  return (read?.all ?? [])
    .filter((t) => {
      const tenant = read?.tenants.get(t.id);
      // A task McBot made knows its board; another board's never shows here.
      if (tenant && tenant.startsWith("mcbot-")) return tenant === mine;
      return t.assignee === null || profiles.has(t.assignee) || (t.createdBy !== null && profiles.has(t.createdBy));
    })
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

/** One task with its comment thread and every attempt. Null when there is no such task. */
export function readTask(root: string, id: string, profiles: ReadonlyMap<string, string>): TaskDetail | null {
  return withDb(root, (db) => {
    const [task] = readAll(db, profiles, "WHERE id = ?", id);
    if (!task) return null;
    const thread: TaskComment[] = (db.prepare("SELECT * FROM task_comments WHERE task_id = ? ORDER BY id").all(id) as Row[]).map((r) => ({
      id: Number(r.id), author: String(r.author ?? ""), body: String(r.body ?? ""), at: ms(r.created_at) ?? 0,
    }));
    const attempts: TaskAttempt[] = (db.prepare("SELECT * FROM task_runs WHERE task_id = ? ORDER BY id").all(id) as Row[]).map((r) => ({
      id: Number(r.id), profile: str(r.profile), status: String(r.status ?? ""), outcome: str(r.outcome), summary: str(r.summary), error: str(r.error),
      startedAt: ms(r.started_at) ?? 0, endedAt: ms(r.ended_at),
    }));
    return { ...task, thread, attempts };
  });
}

/** Hermes' own task ids: `t_` and hex (hermes_cli/kanban_db.py `_new_task_id`). */
export const TASK_ID_RE = /^t_[a-f0-9]{4,32}$/;

export interface NewTask {
  title: string;
  body: string;
  /** A profile on this board, or null to leave it for someone to pick up. */
  assignee: string | null;
  /** The person creating it (`--created-by`). */
  createdBy: string;
  /** Tasks it waits for (`--parent`, repeatable). */
  parents?: string[];
  /** The board it belongs to (`--tenant`, `boardTenant`). */
  tenant?: string;
}

/**
 * argv for `hermes kanban create`. The body goes on stdin (`--body-file -`) and the title after
 * `--`, so neither is read as a flag (hermes_cli/kanban_parser.py `create`).
 */
export function createArgv(t: NewTask): string[] {
  const argv = ["kanban", "create", "--body-file", "-", "--created-by", t.createdBy, "--json"];
  if (t.tenant) argv.push("--tenant", t.tenant);
  if (t.assignee) argv.push("--assignee", t.assignee);
  for (const p of t.parents ?? []) argv.push("--parent", p);
  return [...argv, "--", t.title];
}

/** argv for a person's action on a task (hermes_cli/kanban_parser.py), with free text after `--`. */
export function actionArgv(id: string, a: TaskAction, author: string): string[] {
  switch (a.action) {
    case "comment":
      return ["kanban", "comment", id, "--author", author, "--", a.text];
    case "assign":
      return ["kanban", "assign", id, a.profile ?? "none"];
    case "complete":
      return ["kanban", "complete", id, ...(a.text ? ["--result", a.text] : [])];
    case "block":
      return ["kanban", "block", id, ...(a.text ? ["--", a.text] : [])];
    case "unblock":
      return ["kanban", "unblock", id];
    case "changes":
      // A person's review verdict: back to its agent with the reason as a comment (review → ready).
      return ["kanban", "reopen-review", id, "--reason", a.text];
    case "archive":
      return ["kanban", "archive", id];
  }
}

export interface KanbanResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Run `hermes <argv>` under `root` (no profile: the root's own board), `stdin` on stdin. */
export function runKanban(bin: HermesBinary, root: string, argv: string[], stdin = "", timeoutMs = 60_000): Promise<KanbanResult> {
  return new Promise((resolve) => {
    const cmd = hermesCommand(bin, argv, hermesEnv(root));
    const child = spawn(cmd.file, cmd.args, { env: cmd.env, shell: bin.shell, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(stdin);
  });
}

/** Hermes' own words when a command fails, without its colour codes and setup chatter. */
export function kanbanError(r: KanbanResult): string {
  const text = `${r.stderr}\n${r.stdout}`.replace(/\x1b\[[0-9;]*m/g, "");
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("warning:"));
  return lines.reverse().find((l) => /error|cannot|no such|invalid|refus|not /i.test(l)) ?? lines[0] ?? `hermes kanban exited ${r.code}`;
}
