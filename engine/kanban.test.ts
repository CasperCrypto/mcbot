import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { actionArgv, boardTenant, createArgv, kanbanDb, kanbanError, readTask, readTasks } from "./kanban";

/** The tables McBot reads, as Hermes creates them (hermes_cli/kanban_db.py SCHEMA_SQL, columns McBot reads). */
const DDL = `
CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT, assignee TEXT, status TEXT NOT NULL, priority INTEGER DEFAULT 0,
  created_by TEXT, created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER, result TEXT, last_failure_error TEXT, some_future_column TEXT);
CREATE TABLE task_links (parent_id TEXT NOT NULL, child_id TEXT NOT NULL, PRIMARY KEY (parent_id, child_id));
CREATE TABLE task_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE task_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, profile TEXT, status TEXT NOT NULL, started_at INTEGER NOT NULL,
  ended_at INTEGER, outcome TEXT, summary TEXT, error TEXT);
`;

function board(): string {
  const root = mkdtempSync(join(tmpdir(), "mcbot-kanban-"));
  const db = new DatabaseSync(kanbanDb(root));
  db.exec(DDL);
  const task = db.prepare("INSERT INTO tasks (id, title, body, assignee, status, created_by, created_at, started_at, completed_at, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  task.run("t_00000001", "Write the launch post", "Two paragraphs", "writer", "done", "triage", 1_700_000_000, 1_700_000_010, 1_700_000_020, null);
  task.run("t_00000002", "Edit the post", "", "editor", "ready", "triage", 1_700_000_100, null, null, null);
  task.run("t_00000003", "Pick a launch date", "", null, "triage", "Ada", 1_700_000_200, null, null, null);
  task.run("t_00000004", "Another board's work", "", "stranger", "ready", "stranger", 1_700_000_300, null, null, null);
  task.run("t_00000005", "Old", "", "writer", "archived", "Ada", 1_700_000_050, null, null, null);
  db.prepare("INSERT INTO task_links VALUES (?, ?)").run("t_00000001", "t_00000002");
  db.prepare("INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?, ?, ?, ?)").run("t_00000001", "Ada", "Keep it short", 1_700_000_005);
  const run = db.prepare("INSERT INTO task_runs (task_id, profile, status, started_at, ended_at, outcome, summary, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  run.run("t_00000001", "writer", "crashed", 1_700_000_010, 1_700_000_012, "crashed", null, "boom");
  run.run("t_00000001", "writer", "done", 1_700_000_013, 1_700_000_020, "completed", "Posted", null);
  db.close();
  return root;
}

const TEAM = new Map([["triage", "n-triage"], ["writer", "n-writer"], ["editor", "n-editor"]]);

describe("readTasks", () => {
  it("lists this team's tasks and unassigned ones, newest first, without archived ones", () => {
    const tasks = readTasks(board(), TEAM);
    expect(tasks.map((t) => t.id)).toEqual(["t_00000003", "t_00000002", "t_00000001"]);
    expect(tasks[2]).toEqual({
      id: "t_00000001", title: "Write the launch post", body: "Two paragraphs", assignee: "writer", agentNodeId: "n-writer", status: "done", priority: 0,
      createdBy: "triage", createdAt: 1_700_000_000_000, startedAt: 1_700_000_010_000, completedAt: 1_700_000_020_000,
      result: "Posted", error: null, parents: [], children: ["t_00000002"], comments: 1,
    });
    expect(tasks[1]).toMatchObject({ parents: ["t_00000001"], agentNodeId: "n-editor" });
    expect(tasks[0]).toMatchObject({ assignee: null, agentNodeId: null, status: "triage", createdBy: "Ada" });
  });

  it("is empty before Hermes has a board", () => {
    expect(readTasks(mkdtempSync(join(tmpdir(), "mcbot-kanban-")), TEAM)).toEqual([]);
  });

  it("reads one task with its thread and every attempt", () => {
    const t = readTask(board(), "t_00000001", TEAM)!;
    expect(t.thread).toEqual([{ id: 1, author: "Ada", body: "Keep it short", at: 1_700_000_005_000 }]);
    expect(t.attempts.map((a) => [a.outcome, a.summary, a.error])).toEqual([["crashed", null, "boom"], ["completed", "Posted", null]]);
    expect(readTask(board(), "t_ffffffff", TEAM)).toBeNull();
  });
});

describe("hermes kanban argv", () => {
  it("creates with the body on stdin and the title after --", () => {
    expect(createArgv({ title: "--help me", body: "x", assignee: "writer", createdBy: "Ada", parents: ["t_00000001"] })).toEqual([
      "kanban", "create", "--body-file", "-", "--created-by", "Ada", "--json", "--assignee", "writer", "--parent", "t_00000001", "--", "--help me",
    ]);
    expect(createArgv({ title: "Pick a date", body: "", assignee: null, createdBy: "Ada" })).toEqual(["kanban", "create", "--body-file", "-", "--created-by", "Ada", "--json", "--", "Pick a date"]);
  });

  it("maps each action to its command", () => {
    const id = "t_00000001";
    expect(actionArgv(id, { action: "comment", text: "-v looks good" }, "Ada")).toEqual(["kanban", "comment", id, "--author", "Ada", "--", "-v looks good"]);
    expect(actionArgv(id, { action: "assign", profile: null }, "Ada")).toEqual(["kanban", "assign", id, "none"]);
    expect(actionArgv(id, { action: "complete", text: "Shipped" }, "Ada")).toEqual(["kanban", "complete", id, "--result", "Shipped"]);
    expect(actionArgv(id, { action: "block" }, "Ada")).toEqual(["kanban", "block", id]);
    expect(actionArgv(id, { action: "unblock" }, "Ada")).toEqual(["kanban", "unblock", id]);
    expect(actionArgv(id, { action: "changes", text: "Shorter" }, "Ada")).toEqual(["kanban", "reopen-review", id, "--reason", "Shorter"]);
    expect(actionArgv(id, { action: "archive" }, "Ada")).toEqual(["kanban", "archive", id]);
  });

  it("reports Hermes' own error line", () => {
    expect(kanbanError({ code: 1, stdout: "", stderr: "\x1b[0;36m→\x1b[0m Checking for uv...\ncannot unblock t_1: not blocked\n" })).toBe("cannot unblock t_1: not blocked");
  });
});

describe("tasks per board (Hermes tenant)", () => {
  it("shows a task McBot made on one board only there, and keeps the old rule for tasks without one", () => {
    const db = board();
    const conn = new DatabaseSync(join(db, "kanban.db"));
    conn.exec("ALTER TABLE tasks ADD COLUMN tenant TEXT");
    conn.prepare("INSERT INTO tasks (id, title, status, created_at, tenant) VALUES (?, ?, 'todo', 1700000999, ?)").run("t_000000aa", "Marketing plan", "mcbot-marketing");
    conn.close();
    expect(readTasks(db, TEAM, "marketing").map((t) => t.id)).toContain("t_000000aa");
    expect(readTasks(db, TEAM, "support").map((t) => t.id)).not.toContain("t_000000aa");
    // A task with no tenant (made before, or by Hermes itself) follows the old rule.
    expect(readTasks(db, TEAM, "support").length).toBeGreaterThan(0);
  });

  it("creates tasks in the board's tenant", () => {
    expect(createArgv({ title: "x", body: "", assignee: null, createdBy: "Ada", tenant: boardTenant("support") })).toEqual(
      ["kanban", "create", "--body-file", "-", "--created-by", "Ada", "--json", "--tenant", "mcbot-support", "--", "x"]);
  });
});
