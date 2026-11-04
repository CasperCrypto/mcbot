import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { compile } from "../src/compile";
import { OwnershipError, writeCompileResult } from "./writer";

const fixture = () => JSON.parse(readFileSync(join(import.meta.dirname, "../test/fixtures/three-node.graph.json"), "utf8"));
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mcbot-writer-"));
});

describe("writeCompileResult", () => {
  it("writes every file byte-for-byte and reports them as added", async () => {
    const result = compile(fixture());
    const report = await writeCompileResult(result, root);
    expect(report.changes.every((c) => c.status === "added")).toBe(true);
    for (const f of result.files) expect(readFileSync(join(root, f.path), "utf8")).toBe(f.content);
    expect(existsSync(join(root, "profiles/triage/memories"))).toBe(true);
    expect(existsSync(join(root, "profiles/triage/skills"))).toBe(true);
  });

  it("is idempotent: a second compile changes nothing", async () => {
    await writeCompileResult(compile(fixture()), root);
    const again = await writeCompileResult(compile(fixture()), root);
    expect(again.changes.map((c) => c.status)).toEqual(again.changes.map(() => "unchanged"));
    expect(again.changes.every((c) => c.diff === "")).toBe(true);
  });

  it("reports a unified diff for a changed file", async () => {
    await writeCompileResult(compile(fixture()), root);
    const g = fixture();
    g.nodes[1].data.model = "qwen3:14b";
    const report = await writeCompileResult(compile(g), root);
    const cfg = report.changes.find((c) => c.path === "profiles/triage/config.yaml")!;
    expect(cfg.status).toBe("modified");
    expect(cfg.diff).toContain("-  default: qwen3:8b\n+  default: qwen3:14b\n");
  });

  it("deletes only files its previous manifest lists, never Hermes runtime state", async () => {
    const g = fixture();
    g.nodes[0].data.skills = [{ name: "triage-rules", description: "Route tickets by product area." }];
    await writeCompileResult(compile(g), root);
    writeFileSync(join(root, "profiles/triage/memories/MEMORY.md"), "learned something");
    mkdirSync(join(root, "profiles/triage/skills/hermes-agent"), { recursive: true });
    writeFileSync(join(root, "profiles/triage/skills/hermes-agent/SKILL.md"), "seeded by hermes");

    g.nodes[0].data.skills = [];
    const report = await writeCompileResult(compile(g), root);
    expect(report.changes.find((c) => c.path.endsWith("triage-rules/SKILL.md"))?.status).toBe("removed");
    expect(existsSync(join(root, "profiles/triage/skills/triage-rules/SKILL.md"))).toBe(false);
    expect(readFileSync(join(root, "profiles/triage/memories/MEMORY.md"), "utf8")).toBe("learned something");
    expect(existsSync(join(root, "profiles/triage/skills/hermes-agent/SKILL.md"))).toBe(true);
  });

  it("refuses to overwrite a profile directory McBot did not create", async () => {
    mkdirSync(join(root, "profiles/triage"), { recursive: true });
    writeFileSync(join(root, "profiles/triage/config.yaml"), "model: mine\n");
    await expect(writeCompileResult(compile(fixture()), root)).rejects.toBeInstanceOf(OwnershipError);
    expect(readFileSync(join(root, "profiles/triage/config.yaml"), "utf8")).toBe("model: mine\n");
  });

  it("dry run reports without writing", async () => {
    const report = await writeCompileResult(compile(fixture()), root, { dryRun: true });
    expect(report.written).toBe(false);
    expect(report.changes.length).toBeGreaterThan(0);
    expect(existsSync(join(root, "profiles"))).toBe(false);
  });
});
