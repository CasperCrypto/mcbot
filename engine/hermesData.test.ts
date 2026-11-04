import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryConflict, parseMemory, readMemory, readSessions, renderMemory, writeMemory } from "./hermesData";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mcbot-data-"));
  mkdirSync(join(root, "profiles/triage/memories"), { recursive: true });
});

describe("memory format (tools/memory_tool_store.py)", () => {
  it("parses on the full delimiter, so a bare § inside an entry survives", () => {
    expect(parseMemory("one\n§\n  two § stays  \n§\n\n§\nthree")).toEqual(["one", "two § stays", "three"]);
  });
  it("renders exactly like MemoryStore._write_file (no trailing newline)", () => {
    expect(renderMemory(["one", " two "])).toBe("one\n§\ntwo");
  });
  it("reads a file Hermes' memory tool wrote", async () => {
    // Byte-identical to the MEMORY.md a real `memory add` produced in the e2e run.
    writeFileSync(join(root, "profiles/triage/memories/MEMORY.md"), "The Acme escalation channel is #acme-urgent");
    const m = await readMemory(root, "triage", "memory");
    expect(m).toMatchObject({ exists: true, entries: ["The Acme escalation channel is #acme-urgent"], chars: 43, limit: 2200 });
  });
});

describe("writeMemory", () => {
  it("writes when the base hash matches and refuses a stale one", async () => {
    const path = join(root, "profiles/triage/memories/MEMORY.md");
    writeFileSync(path, "a");
    const before = await readMemory(root, "triage", "memory");
    const after = await writeMemory(root, "triage", "memory", ["a", "b"], before.sha256);
    expect(readFileSync(path, "utf8")).toBe("a\n§\nb");
    await expect(writeMemory(root, "triage", "memory", ["c"], before.sha256)).rejects.toBeInstanceOf(MemoryConflict);
    expect(after.entries).toEqual(["a", "b"]);
  });
  it("enforces Hermes' character budget", async () => {
    await expect(writeMemory(root, "triage", "user", ["x".repeat(1376)], null)).rejects.toThrow(/1375-char user limit/);
  });
});

describe("readSessions", () => {
  it("reads the sessions table Hermes writes", () => {
    const db = new DatabaseSync(join(root, "profiles/triage/state.db"));
    db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT NOT NULL, model TEXT, billing_provider TEXT,
      billing_base_url TEXT, started_at REAL NOT NULL, ended_at REAL, input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0, estimated_cost_usd REAL, cost_status TEXT, api_call_count INTEGER DEFAULT 0, title TEXT)`);
    db.prepare("INSERT INTO sessions (id, source, model, billing_provider, billing_base_url, started_at, input_tokens, output_tokens, estimated_cost_usd, cost_status, api_call_count, title) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("local-1", "oneshot", "stub-model", "custom", "http://127.0.0.1:11500/v1", 1793750038.8, 1245, 1, 0, "unknown", 1, "4");
    db.close();
    expect(readSessions(root, "triage")).toEqual([expect.objectContaining({
      id: "local-1", model: "stub-model", billingBaseUrl: "http://127.0.0.1:11500/v1", inputTokens: 1245, outputTokens: 1,
      estimatedCostUsd: 0, costStatus: "unknown", apiCalls: 1, cacheReadTokens: 0,
    })]);
  });
  it("returns nothing for a profile that never ran", () => {
    expect(readSessions(root, "triage")).toEqual([]);
  });
});
