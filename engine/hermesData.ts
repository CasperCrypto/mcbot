/**
 * Reads (and, for memory, writes) what Hermes itself records in a profile:
 *   memories/MEMORY.md, memories/USER.md  — tools/memory_tool_store.py
 *   state.db `sessions` table             — hermes_state_common.py
 * Formats are Hermes', byte for byte; McBot adds no files here.
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { sha256Hex } from "../src/compile/text";
import { atomicWrite, readTextOrNull, resolveInside } from "./fsutil";

/** tools/memory_tool_store.py ENTRY_DELIMITER */
export const MEMORY_DELIMITER = "\n§\n";
/** hermes_cli/config_defaults.py memory.memory_char_limit / memory.user_char_limit */
export const MEMORY_CHAR_LIMITS = { memory: 2200, user: 1375 } as const;
export type MemoryTarget = keyof typeof MEMORY_CHAR_LIMITS;
const FILES: Record<MemoryTarget, string> = { memory: "MEMORY.md", user: "USER.md" };

/** Python len(): code points, not UTF-16 units. */
const chars = (s: string) => [...s].length;

/** MemoryStore._parse_entries: split on the FULL delimiter, strip, drop empties. */
export function parseMemory(raw: string): string[] {
  return raw.replace(/^﻿/, "").split(MEMORY_DELIMITER).map((e) => e.trim()).filter(Boolean);
}

/** MemoryStore._write_file: entries joined by the delimiter, nothing appended. */
export function renderMemory(entries: readonly string[]): string {
  return entries.map((e) => e.trim()).filter(Boolean).join(MEMORY_DELIMITER);
}

export interface MemoryFile {
  target: MemoryTarget;
  path: string;
  exists: boolean;
  entries: string[];
  chars: number;
  limit: number;
  /** sha256 of the file as read; send it back to write (optimistic concurrency). */
  sha256: string | null;
}

export async function readMemory(root: string, profile: string, target: MemoryTarget): Promise<MemoryFile> {
  const rel = `profiles/${profile}/memories/${FILES[target]}`;
  const raw = await readTextOrNull(resolveInside(root, rel));
  const entries = raw === null ? [] : parseMemory(raw);
  return {
    target,
    path: rel,
    exists: raw !== null,
    entries,
    chars: chars(renderMemory(entries)),
    limit: MEMORY_CHAR_LIMITS[target],
    sha256: raw === null ? null : sha256Hex(raw),
  };
}

export class MemoryConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryConflict";
  }
}

/**
 * Replace a memory file's entries. Hermes guards its own writes with an flock
 * on <file>.lock, which Node cannot take; so the caller must pass the sha256
 * it read (a file changed since then is refused) and the engine must not call
 * this while a run of the profile is active.
 */
export async function writeMemory(root: string, profile: string, target: MemoryTarget, entries: readonly string[], baseSha256: string | null): Promise<MemoryFile> {
  const current = await readMemory(root, profile, target);
  if (current.sha256 !== baseSha256) throw new MemoryConflict(`${current.path} changed since it was read; reload and try again`);
  const text = renderMemory(entries);
  if (chars(text) > MEMORY_CHAR_LIMITS[target])
    throw new MemoryConflict(`${chars(text)} chars exceeds Hermes' ${MEMORY_CHAR_LIMITS[target]}-char ${target} limit`);
  await atomicWrite(resolveInside(root, current.path), text);
  return readMemory(root, profile, target);
}

export interface SessionRow {
  id: string;
  source: string | null;
  model: string | null;
  billingProvider: string | null;
  billingBaseUrl: string | null;
  startedAt: number;
  endedAt: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  apiCalls: number;
  toolCalls: number;
  messages: number;
  estimatedCostUsd: number | null;
  actualCostUsd: number | null;
  costStatus: string | null;
  title: string | null;
}

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : 0);
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : num(v));
const str = (v: unknown) => (typeof v === "string" ? v : null);

function toSession(r: Row): SessionRow {
  return {
    id: String(r.id),
    source: str(r.source),
    model: str(r.model),
    billingProvider: str(r.billing_provider),
    billingBaseUrl: str(r.billing_base_url),
    startedAt: num(r.started_at),
    endedAt: numOrNull(r.ended_at),
    inputTokens: num(r.input_tokens),
    outputTokens: num(r.output_tokens),
    cacheReadTokens: num(r.cache_read_tokens),
    cacheWriteTokens: num(r.cache_write_tokens),
    reasoningTokens: num(r.reasoning_tokens),
    apiCalls: num(r.api_call_count),
    toolCalls: num(r.tool_call_count),
    messages: num(r.message_count),
    estimatedCostUsd: numOrNull(r.estimated_cost_usd),
    actualCostUsd: numOrNull(r.actual_cost_usd),
    costStatus: str(r.cost_status),
    title: str(r.title),
  };
}

function withDb<T>(root: string, profile: string, fn: (db: DatabaseSync) => T): T | null {
  const path = resolveInside(root, `profiles/${profile}/state.db`);
  if (!existsSync(path)) return null;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** Every session row of a profile, oldest first. `SELECT *` so newer Hermes columns don't break us. */
export function readSessions(root: string, profile: string): SessionRow[] {
  return withDb(root, profile, (db) => (db.prepare("SELECT * FROM sessions ORDER BY started_at").all() as Row[]).map(toSession)) ?? [];
}

export function readSession(root: string, profile: string, id: string): SessionRow | null {
  return withDb(root, profile, (db) => {
    const r = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Row | undefined;
    return r ? toSession(r) : null;
  });
}
