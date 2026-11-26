import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FsListing, FsPreview, FsRoot } from "../src/contracts/api";
import { startEngine, type Engine } from "./server";

const ORIGIN = "http://localhost:5173";
let engine: Engine;
let outside: string;
let workspace: string;

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), "mcbot-fs-"));
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

  it("saves an edited file only over what the editor read, and never a key file or outside the folder", async () => {
    const { body: root } = await api<FsRoot>("/api/fs/roots", { path: outside });
    const put = async (body: unknown) => {
      const res = await fetch(`${engine.url}/api/fs/write`, { method: "PUT", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: res.status, body: (await res.json()) as { sha256?: string; error?: string } };
    };
    const read = (await api<FsPreview>(`/api/fs/read?root=${root.id}&path=src/index.ts`)).body;
    expect(read.sha256).toMatch(/^[0-9a-f]{64}$/);
    const saved = await put({ root: root.id, path: "src/index.ts", text: "export const b = 2;\n", baseSha256: read.sha256 });
    expect(saved.status).toBe(200);
    expect(readFileSync(join(outside, "src/index.ts"), "utf8")).toBe("export const b = 2;\n");
    // Someone (an agent) changed it after the editor read it: refused, nothing lost.
    expect((await put({ root: root.id, path: "src/index.ts", text: "x", baseSha256: read.sha256 })).status).toBe(409);
    expect((await put({ root: root.id, path: "new.md", text: "# New\n", baseSha256: null })).status).toBe(200);
    expect((await put({ root: root.id, path: ".env", text: "KEY=1", baseSha256: null })).status).toBe(403);
    expect((await put({ root: root.id, path: "../escape.txt", text: "x", baseSha256: null })).status).toBe(400);
  });

  it("forgets a closed folder", async () => {
    const { body: root } = await api<FsRoot>("/api/fs/roots", { path: outside });
    await api("/api/fs/roots/close", { id: root.id });
    expect((await api(`/api/fs/list?root=${root.id}&path=`)).status).toBe(404);
  });
});

describe("changing files", () => {
  const post = async <T,>(path: string, body: unknown) => api<T & { error?: string }>(path, body);
  const upload = async (root: string, dir: string, name: string, data: string) => {
    const res = await fetch(`${engine.url}/api/fs/upload?root=${encodeURIComponent(root)}&dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(name)}`, {
      method: "POST", headers: { origin: ORIGIN, "content-type": "application/octet-stream" }, body: data,
    });
    return { status: res.status, body: (await res.json()) as { path?: string; bytes?: number; error?: string } };
  };
  let project: string;
  let root: FsRoot;
  beforeAll(async () => {
    project = mkdtempSync(join(tmpdir(), "mcbot-change-"));
    mkdirSync(join(project, "notes"), { recursive: true });
    writeFileSync(join(project, "notes/plan.md"), "# Plan\n");
    root = (await api<FsRoot>("/api/fs/roots", { path: project })).body;
  });

  it("adds a dropped file beside the others, never over one", async () => {
    expect(await upload(root.id, "notes", "brief.md", "# Brief\n")).toMatchObject({ status: 200, body: { path: "notes/brief.md", bytes: 8 } });
    expect((await upload(root.id, "notes", "plan.md", "# Other\n")).body.path).toBe("notes/plan (2).md");
    expect(readFileSync(join(project, "notes/plan.md"), "utf8")).toBe("# Plan\n");
    // Only the name counts: a path in it is dropped, and dotfiles keep their dot.
    expect((await upload(root.id, "", "../../evil/.gitignore", "dist\n")).body.path).toBe(".gitignore");
    expect((await upload(root.id, "", ".env", "KEY=1")).status).toBe(403);
    expect((await upload(root.id, "../", "x.md", "x")).status).toBe(400);
    expect((await upload(root.id, "gone", "x.md", "x")).status).toBe(404);
  });

  it("makes folders and renames or moves things, never over something", async () => {
    expect((await post("/api/fs/mkdir", { root: root.id, dir: "", name: "drafts" })).body).toEqual({ path: "drafts" });
    expect((await post("/api/fs/mkdir", { root: root.id, dir: "", name: "drafts" })).status).toBe(409);
    expect((await post("/api/fs/mkdir", { root: root.id, dir: "", name: "a/b" })).status).toBe(400);
    expect((await post("/api/fs/rename", { root: root.id, from: "notes/brief.md", to: "notes/Brief v2.md" })).body).toEqual({ path: "notes/Brief v2.md" });
    expect((await post("/api/fs/rename", { root: root.id, from: "notes/Brief v2.md", to: "drafts/Brief v2.md" })).status).toBe(200);
    expect(existsSync(join(project, "drafts/Brief v2.md"))).toBe(true);
    expect((await post("/api/fs/rename", { root: root.id, from: "notes/plan (2).md", to: "notes/plan.md" })).status).toBe(409);
    expect((await post("/api/fs/rename", { root: root.id, from: "notes", to: "notes/inner" })).status).toBe(400);
    expect((await post("/api/fs/rename", { root: root.id, from: "notes/plan.md", to: "../plan.md" })).status).toBe(400);
    expect((await post("/api/fs/rename", { root: root.id, from: "notes/plan.md", to: "notes/.env" })).status).toBe(403);
    expect((await post("/api/fs/rename", { root: root.id, from: ".", to: "x" })).status).toBe(403);
  });

  it("deletes into the trash, and Undo puts it back", async () => {
    writeFileSync(join(project, "drafts/keep.txt"), "keep\n");
    const del = await post<{ trash: string; name: string }>("/api/fs/delete", { root: root.id, path: "drafts" });
    expect(del.body.name).toBe("drafts");
    expect(existsSync(join(project, "drafts"))).toBe(false);
    expect(readdirSync(join(workspace, ".trash")).length).toBe(2);
    expect((await post("/api/fs/restore", { trash: del.body.trash })).body).toEqual({ root: root.id, path: "drafts" });
    expect(readFileSync(join(project, "drafts/keep.txt"), "utf8")).toBe("keep\n");
    expect(readdirSync(join(workspace, ".trash"))).toEqual([]);
    // Its place was taken meanwhile: it comes back beside it.
    const again = await post<{ trash: string }>("/api/fs/delete", { root: root.id, path: "drafts/keep.txt" });
    writeFileSync(join(project, "drafts/keep.txt"), "new\n");
    expect((await post<{ path: string }>("/api/fs/restore", { trash: again.body.trash })).body.path).toBe("drafts/keep (2).txt");
    expect((await post("/api/fs/restore", { trash: again.body.trash })).status).toBe(404);
    // Never the folder itself.
    for (const path of [".", "./", "notes/.."]) expect((await post("/api/fs/delete", { root: root.id, path })).status).toBe(400);
    expect(existsSync(project)).toBe(true);
  });

  it("streams an image for the preview, and nothing that isn't a picture, video or sound", async () => {
    writeFileSync(join(project, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const raw = (path: string) => fetch(`${engine.url}/api/fs/raw?root=${encodeURIComponent(root.id)}&path=${encodeURIComponent(path)}`, { headers: { origin: ORIGIN } });
    const png = await raw("logo.png");
    expect([png.status, png.headers.get("content-type")]).toEqual([200, "image/png"]);
    expect(Buffer.from(await png.arrayBuffer()).length).toBe(4);
    expect((await raw("notes/plan.md")).status).toBe(415);
    expect((await raw("../x.png")).status).toBe(400);
  });

  it("keeps an agent's own files where they are: only its workspace/ changes", async () => {
    const { addable, changeable, normal, safeName } = await import("./folders");
    expect([addable("profile:a", "workspace"), addable("profile:a", "workspace/out"), addable("profile:a", ""), addable("profile:a", "memories")]).toEqual([true, true, false, false]);
    expect([changeable("profile:a", "workspace/x.md"), changeable("profile:a", "workspace"), changeable("profile:a", "SOUL.md"), changeable("folder:x", "SOUL.md"), changeable("folder:x", "")]).toEqual([true, false, false, true, false]);
    expect([normal("a/./b/"), normal("."), normal("workspace/."), normal("a\\b")]).toEqual(["a/b", "", "workspace", "a/b"]);
    expect([safeName("C:\\x\\Report.pdf"), safeName(".."), safeName("  "), safeName("a<b>.md")]).toEqual(["Report.pdf", null, null, "ab.md"]);
  });
});

describe("the folder picker", () => {
  it("lists only the folders inside a folder, and the usual places", async () => {
    const { browseFolders, expandHome } = await import("./folders");
    mkdirSync(join(outside, "Documents"), { recursive: true });
    mkdirSync(join(outside, ".hidden"), { recursive: true });
    const b = await browseFolders(outside, outside);
    expect(b.path).toBe(outside);
    expect(b.dirs.map((d) => d.name)).toEqual(["Documents", "src"]);
    expect(b.places.map((p) => p.name)).toEqual(["Home", "Documents", "src"]);
    expect((await browseFolders("~/src", outside)).dirs.map((d) => d.name)).toEqual(["lib"]);
    expect(expandHome("~/x", "/home/me")).toBe(join("/home/me", "x"));
    await expect(browseFolders(join(outside, "nope"), outside)).rejects.toThrow(/doesn't exist/);
    const res = await api<{ dirs: unknown[] }>(`/api/fs/browse?path=${encodeURIComponent(outside)}`);
    expect(res.status).toBe(200);
  });
});
