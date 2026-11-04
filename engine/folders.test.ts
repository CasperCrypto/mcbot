import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FsListing, FsPreview, FsRoot } from "../src/contracts/api";
import { startEngine, type Engine } from "./server";

const ORIGIN = "http://localhost:5173";
let engine: Engine;
let outside: string;

beforeAll(async () => {
  const workspace = mkdtempSync(join(tmpdir(), "mcbot-fs-"));
  mkdirSync(join(workspace, "files"), { recursive: true });
  outside = mkdtempSync(join(tmpdir(), "mcbot-project-"));
  mkdirSync(join(outside, "src/lib"), { recursive: true });
  writeFileSync(join(outside, "README.md"), "# Project\n");
  writeFileSync(join(outside, "src/index.ts"), "export {};\n");
  writeFileSync(join(outside, "src/lib/a.ts"), "export const a = 1;\n");
  writeFileSync(join(outside, "blob.bin"), Buffer.from([0, 1, 2]));
  engine = await startEngine({ workspace, hermesHome: join(workspace, "hermes"), managedRoot: true, port: 0, host: "127.0.0.1", allowedOrigins: [ORIGIN] });
  await engine.relay.create("b", "Board");
});
afterAll(() => engine?.close());

async function api<T>(path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(`${engine.url}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

describe("folder browsing", () => {
  it("only lists folders the user opened", async () => {
    const before = await api<FsRoot[]>("/api/fs/roots?boardId=b");
    expect(before.body.map((r) => r.id)).toEqual(["workspace:files"]);
    expect((await api(`/api/fs/list?root=folder:nope&path=`)).status).toBe(404);
    expect((await api("/api/fs/roots", { path: "relative/dir" })).status).toBe(400);
  });

  it("opens a folder, lists it level by level, and previews text files", async () => {
    const { body: root } = await api<FsRoot>("/api/fs/roots", { path: outside });
    expect(root.id).toMatch(/^folder:[0-9a-f]{10}$/);
    const top = await api<FsListing>(`/api/fs/list?root=${root.id}&path=`);
    expect(top.body.entries.map((e) => [e.name, e.kind, e.children])).toEqual([
      ["src", "dir", 2], ["blob.bin", "file", null], ["README.md", "file", null],
    ]);
    const src = await api<FsListing>(`/api/fs/list?root=${root.id}&path=src`);
    expect(src.body.entries.map((e) => e.path)).toEqual(["src/lib", "src/index.ts"]);
    expect((await api<FsPreview>(`/api/fs/read?root=${root.id}&path=README.md`)).body.text).toBe("# Project\n");
    expect((await api<FsPreview>(`/api/fs/read?root=${root.id}&path=blob.bin`)).body).toMatchObject({ text: null, reason: "Binary file" });
  });

  it("refuses to leave the opened folder", async () => {
    const { body: root } = await api<FsRoot>("/api/fs/roots", { path: outside });
    expect((await api(`/api/fs/list?root=${root.id}&path=../`)).status).toBe(400);
    expect((await api(`/api/fs/read?root=${root.id}&path=${encodeURIComponent("../../etc/passwd")}`)).status).toBe(400);
  });

  it("forgets a closed folder", async () => {
    const { body: root } = await api<FsRoot>("/api/fs/roots", { path: outside });
    await api("/api/fs/roots/close", { id: root.id });
    expect((await api(`/api/fs/list?root=${root.id}&path=`)).status).toBe(404);
  });
});
