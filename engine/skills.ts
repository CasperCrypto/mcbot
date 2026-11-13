/**
 * Hermes' skills for McBot's agents.
 *
 * - Bundled skills (hermes/skills, 44): Hermes seeds them into a home's `skills/<category>/` and
 *   records them in `skills/.bundled_manifest` (tools/skills_sync.py:38). Its gateway seeds only its
 *   own home, so a profile McBot compiles gets them from `hermes -p <agent> skills opt-in --sync`
 *   (hermes_cli/subcommands/skills.py:129-133, skills_hub.py:1257), run once per profile after a
 *   compile unless the board turned them off (`builtinSkills: false` → `.no-bundled-skills`).
 * - Official optional skills (hermes/optional-skills, ~140): listed from their SKILL.md and installed
 *   with `hermes -p <agent> skills install official/<path> --yes` (subcommands/skills.py:54-63).
 *
 * Seeded and installed skills live in category folders, which the board reader skips: they are
 * Hermes' own, not blocks on the board.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";
import type { LibrarySkill } from "../src/contracts/api";

const front = (text: string): Record<string, unknown> => {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  try {
    const v = parse(m[1]!) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

function skillFiles(dir: string, depth = 0): string[] {
  if (depth > 4 || !existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    const p = join(dir, name);
    if (!statSync(p).isDirectory()) continue;
    if (existsSync(join(p, "SKILL.md"))) out.push(join(p, "SKILL.md"));
    else out.push(...skillFiles(p, depth + 1));
  }
  return out;
}

/** Hermes' official optional skills, from `<hermes>/optional-skills/**\/SKILL.md`. */
export function listLibrary(hermesDir: string): LibrarySkill[] {
  const base = join(hermesDir, "optional-skills");
  return skillFiles(base).map((file) => {
    const rel = relative(base, join(file, "..")).split("\\").join("/");
    const fm = front(readFileSync(file, "utf8"));
    const meta = (fm.metadata as { hermes?: { tags?: unknown } } | undefined)?.hermes;
    const tags = Array.isArray(meta?.tags) ? meta.tags.filter((t): t is string => typeof t === "string") : [];
    return {
      id: `official/${rel}`,
      name: typeof fm.name === "string" ? fm.name : rel.split("/").pop()!,
      category: rel.split("/")[0]!,
      description: typeof fm.description === "string" ? fm.description.replace(/\s+/g, " ").trim() : "",
      tags,
    };
  });
}

/** The skills Hermes keeps in a profile's category folders (seeded or installed), by name. */
export function installedSkills(profileDir: string): string[] {
  const base = join(profileDir, "skills");
  if (!existsSync(base)) return [];
  const names = new Set<string>();
  for (const cat of readdirSync(base)) {
    const dir = join(base, cat);
    if (cat.startsWith(".") || !statSync(dir).isDirectory() || existsSync(join(dir, "SKILL.md"))) continue; // top-level = the board's
    for (const f of skillFiles(dir)) names.add(String(front(readFileSync(f, "utf8")).name ?? relative(dir, join(f, "..")).split("/").pop()));
  }
  return [...names].sort();
}

/** Hermes has seeded this profile's bundled skills (its manifest is there). */
export const bundledSeeded = (profileDir: string) => existsSync(join(profileDir, "skills", ".bundled_manifest"));

export const SEED_ARGV = ["skills", "opt-in", "--sync"] as const;
export const installArgv = (id: string) => ["skills", "install", id, "--yes"];
export const SKILL_ID_RE = /^official\/[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*){1,3}$/;
