import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { compile, CompileError, PROFILE_DIRS } from "./index";
import { sha256Hex } from "./text";

const FIXTURES = join(import.meta.dirname, "../../test/fixtures");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const goldens = readdirSync(FIXTURES).filter((f) => f.endsWith(".graph.json"));

describe("compile — golden output (exact bytes)", () => {
  it.each(goldens)("%s compiles to exactly the files in its .expected/ dir", (name) => {
    const result = compile(JSON.parse(readFileSync(join(FIXTURES, name), "utf8")));
    const expectedDir = join(FIXTURES, name.replace(".graph.json", ".expected"));
    const expectedPaths = walk(expectedDir).map((p) => relative(expectedDir, p).split("\\").join("/")).sort();

    expect(result.files.map((f) => f.path)).toEqual(expectedPaths);
    for (const f of result.files) {
      const expected = readFileSync(join(expectedDir, f.path));
      // Compare bytes, not strings: a CRLF or BOM difference must fail.
      expect(Buffer.from(f.content, "utf8").equals(expected), `${f.path} differs from golden — review, then: npx tsx scripts/update-golden.ts`).toBe(true);
      expect(f.bytes).toBe(expected.length);
      expect(f.sha256).toBe(sha256Hex(expected.toString("utf8")));
    }
  });
});

describe("compile — layout", () => {
  const g = JSON.parse(readFileSync(join(FIXTURES, "three-node.graph.json"), "utf8"));

  it("emits a Hermes profile dir per agent with SOUL.md, config.yaml and skills/", () => {
    const r = compile(g);
    expect(r.profiles).toEqual([{ name: "triage", nodeId: "n-agent", dir: "profiles/triage" }]);
    expect(r.files.map((f) => f.path)).toEqual(
      expect.arrayContaining(["profiles/triage/SOUL.md", "profiles/triage/config.yaml"]),
    );
    for (const d of PROFILE_DIRS) expect(r.dirs).toContain(`profiles/triage/${d}`);
  });

  it("lists every other file in the manifest with its hash", () => {
    const r = compile(g);
    const manifest = JSON.parse(r.files.find((f) => f.role === "manifest")!.content);
    const others = r.files.filter((f) => f.role !== "manifest").map((f) => ({ path: f.path, sha256: f.sha256, bytes: f.bytes }));
    expect(manifest.files).toEqual(others);
  });

  it("is deterministic and ignores array order", () => {
    const shuffled = { ...g, nodes: [...g.nodes].reverse(), edges: [...g.edges].reverse() };
    expect(compile(shuffled)).toEqual(compile(g));
  });

  it("refuses to emit anything when the graph has errors", () => {
    const broken = { ...g, edges: [] };
    expect(() => compile(broken)).toThrow(CompileError);
    try {
      compile(broken);
    } catch (e) {
      expect((e as CompileError).issues.map((i) => i.message)).toEqual(['Agent "triage" has no model; wire a model node to it']);
    }
  });
});
