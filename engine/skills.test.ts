import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SEED_ARGV, SKILL_ID_RE, bundledSeeded, installArgv, installedSkills, listLibrary } from "./skills";

const HERMES = join(import.meta.dirname, "../hermes");

describe("Hermes skills", () => {
  it("lists the official library with the ids `hermes skills install` takes", () => {
    const lib = listLibrary(HERMES);
    expect(lib.length).toBeGreaterThan(100);
    const q = lib.find((s) => s.name === "decision-questionnaire")!;
    expect(q).toMatchObject({ id: "official/productivity/decision-questionnaire", category: "productivity" });
    expect(q.description).toBe("Turn an unanswerable decision into a questionnaire doc.");
    for (const s of lib) expect(s.id).toMatch(SKILL_ID_RE);
  });

  it("reads seeded and installed skills from category folders, not the board's own", () => {
    const dir = mkdtempSync(join(tmpdir(), "skills-"));
    const put = (rel: string, name: string) => { mkdirSync(join(dir, "skills", rel), { recursive: true }); writeFileSync(join(dir, "skills", rel, "SKILL.md"), `---\nname: ${name}\ndescription: x\n---\n`); };
    put("triage-inbox", "triage-inbox"); // a board skill (top level)
    put("productivity/decision-questionnaire", "decision-questionnaire");
    put("mlops/training/axolotl", "axolotl");
    expect(installedSkills(dir)).toEqual(["axolotl", "decision-questionnaire"]);
    expect(bundledSeeded(dir)).toBe(false);
    writeFileSync(join(dir, "skills", ".bundled_manifest"), "");
    expect(bundledSeeded(dir)).toBe(true);
  });

  it("runs Hermes' own commands", () => {
    expect(SEED_ARGV).toEqual(["skills", "opt-in", "--sync"]);
    expect(installArgv("official/creative/meme-generation")).toEqual(["skills", "install", "official/creative/meme-generation", "--yes"]);
    expect(SKILL_ID_RE.test("official/../x")).toBe(false);
    expect(SKILL_ID_RE.test("github/a/b")).toBe(false);
  });
});
