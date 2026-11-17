import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SEED_ARGV, SKILL_ID_RE, SKILL_NAME_RE, bundledSeeded, installArgv, installedSkills, listLibrary, profileSkills, uninstallArgv, updateArgv } from "./skills";

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

  it("tells what the agent taught itself apart from Hermes' seed and the library", () => {
    const dir = mkdtempSync(join(tmpdir(), "skills-"));
    const put = (rel: string, name: string) => { mkdirSync(join(dir, "skills", rel), { recursive: true }); writeFileSync(join(dir, "skills", rel, "SKILL.md"), `---\nname: ${name}\ndescription: does ${name}\n---\n`); };
    put("read-link-lists", "read-link-lists"); // skill_manage without a category
    put("web/build-pages", "build-pages"); // skill_manage with one
    put("productivity/decision-questionnaire", "decision-questionnaire");
    put("note-taking/obsidian", "obsidian");
    writeFileSync(join(dir, "skills", ".bundled_manifest"), "obsidian:abc123\n");
    mkdirSync(join(dir, "skills", ".hub"), { recursive: true });
    writeFileSync(join(dir, "skills", ".hub", "lock.json"), JSON.stringify({ version: 1, installed: { "decision-questionnaire": { source: "official" } } }));
    const by = Object.fromEntries(profileSkills(dir).map((s) => [s.name, s]));
    expect(Object.keys(by)).toEqual(["build-pages", "decision-questionnaire", "obsidian", "read-link-lists"]);
    expect(by["read-link-lists"]).toMatchObject({ origin: "learned", category: null, path: "skills/read-link-lists/SKILL.md", description: "does read-link-lists" });
    expect(by["build-pages"]).toMatchObject({ origin: "learned", category: "web" });
    expect(by["decision-questionnaire"]!.origin).toBe("library");
    expect(by.obsidian!.origin).toBe("builtin");
    expect(profileSkills(join(dir, "missing"))).toEqual([]);
  });

  it("runs Hermes' own commands", () => {
    expect(uninstallArgv("meme-generation")).toEqual(["skills", "uninstall", "meme-generation", "--yes"]);
    expect(updateArgv("meme-generation")).toEqual(["skills", "update", "meme-generation"]);
    expect(SKILL_NAME_RE.test("../x")).toBe(false);
    expect(SEED_ARGV).toEqual(["skills", "opt-in", "--sync"]);
    expect(installArgv("official/creative/meme-generation")).toEqual(["skills", "install", "official/creative/meme-generation", "--yes"]);
    expect(SKILL_ID_RE.test("official/../x")).toBe(false);
    expect(SKILL_ID_RE.test("github/a/b")).toBe(false);
  });
});
