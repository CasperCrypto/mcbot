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
import type { LibrarySkill, ProfileSkill, SkillSearchResult } from "../src/contracts/api";
import { GUIDE_CATEGORY } from "../src/compile/mcbotGuide";

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
  return listSkills(join(hermesDir, "optional-skills"));
}

/** Every SKILL.md under `base` (category folders), read like the library: hermes/skills holds the bundled ones. */
export function listSkills(base: string): LibrarySkill[] {
  if (!existsSync(base)) return [];
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

/**
 * Every skill in a profile, with where it came from, so the Skills view can show what an agent
 * taught itself. Hermes' `skill_manage` writes new skills to `skills/[<category>/]<name>/`
 * (tools/skill_manager_tool.py `_resolve_skill_dir`); bundled ones are listed in
 * `skills/.bundled_manifest` as `name:hash` (tools/skills_sync.py), library installs in
 * `skills/.hub/lock.json` under `installed` (tools/skills_hub.py `HubLockFile`). Anything else
 * the agent (or a person in Hermes) wrote. Top-level skills may be the board's own: the view
 * compares them with the agent's board skills.
 */
export function profileSkills(profileDir: string): ProfileSkill[] {
  const base = join(profileDir, "skills");
  if (!existsSync(base)) return [];
  const bundled = new Set<string>();
  try {
    for (const line of readFileSync(join(base, ".bundled_manifest"), "utf8").split(/\r?\n/)) {
      const name = line.split(":")[0]?.trim();
      if (name) bundled.add(name);
    }
  } catch { /* not seeded */ }
  let hub: Record<string, unknown> = {};
  try {
    const lock = JSON.parse(readFileSync(join(base, ".hub", "lock.json"), "utf8")) as { installed?: Record<string, unknown> };
    if (lock.installed && typeof lock.installed === "object") hub = lock.installed;
  } catch { /* nothing installed */ }
  const out: ProfileSkill[] = [];
  for (const file of skillFiles(base)) {
    const dir = join(file, "..");
    const rel = relative(base, dir).split("\\").join("/");
    const fm = front(readFileSync(file, "utf8"));
    const name = typeof fm.name === "string" && fm.name ? fm.name : rel.split("/").pop()!;
    const folder = rel.split("/").pop()!;
    // McBot's own guide (src/compile/mcbotGuide.ts) comes with McBot, like Hermes' bundled skills.
    const mcbot = rel.split("/")[0] === GUIDE_CATEGORY;
    const origin: ProfileSkill["origin"] = name in hub || folder in hub ? "library" : mcbot || bundled.has(name) || bundled.has(folder) ? "builtin" : "learned";
    out.push({
      name,
      path: `skills/${rel}/SKILL.md`,
      category: rel.includes("/") ? rel.split("/")[0]! : null,
      description: typeof fm.description === "string" ? fm.description.replace(/\s+/g, " ").trim() : "",
      origin,
      modified: statSync(file).mtime.toISOString(),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** `hermes skills uninstall <name> --yes` / `skills update <name>` (hermes_cli/subcommands/skills.py:79-92). */
export const uninstallArgv = (name: string) => ["skills", "uninstall", name, "--yes"];
export const updateArgv = (name: string) => ["skills", "update", name];
export const SKILL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * What a person pastes to add a skill → what `hermes skills install` takes, best first.
 * A GitHub folder link becomes `owner/repo/path` (Hermes' GitHub source fetches the whole folder)
 * and, as a fallback that needs no GitHub API, the raw SKILL.md link (only that file comes).
 * Any other https link to a SKILL.md, and registry identifiers (`skills-sh/…`, `owner/repo/path`),
 * go as they are (hermes_cli/subcommands/skills.py:54-63: "identifier … or a direct HTTP(S) URL").
 */
export function skillSources(input: string): string[] | null {
  const t = input.trim().replace(/\/+$/, "");
  const gh = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)(?:\/(?:tree|blob)\/([\w.\/-]+?))?$/.exec(t);
  if (gh) {
    const [, owner, repo, rest] = gh;
    if (!rest) return [`${owner}/${repo}`];
    const [ref, ...parts] = rest.split("/");
    const path = parts.join("/").replace(/\/?SKILL\.md$/i, "");
    const raw = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path ? `${path}/` : ""}SKILL.md`;
    return path ? [`${owner}/${repo}/${path}`, raw] : [`${owner}/${repo}`, raw];
  }
  if (/^https:\/\/[^\s]+$/.test(t)) return [t];
  if (/^[A-Za-z0-9][\w.-]*(\/[\w.@-]+){1,6}$/.test(t)) return [t];
  return null;
}

/** Skills added by link or search go into one category folder, so they stay Hermes', not board blocks. */
export const ADDED_CATEGORY = "added";
export const addSkillArgv = (source: string) => ["skills", "install", source, "--category", ADDED_CATEGORY, "--yes"];
export const searchSkillsArgv = (q: string) => ["skills", "search", q, "--json", "--limit", "30"];

export function parseSkillSearch(stdout: string): SkillSearchResult[] {
  const at = stdout.indexOf("[");
  if (at < 0) return [];
  try {
    const rows = JSON.parse(stdout.slice(at)) as Record<string, unknown>[];
    return rows.filter((r) => typeof r.identifier === "string" && typeof r.name === "string").map((r) => ({
      name: String(r.name),
      identifier: String(r.identifier),
      source: typeof r.source === "string" ? r.source : "",
      trust: typeof r.trust_level === "string" ? r.trust_level : "",
      description: typeof r.description === "string" ? r.description.replace(/\s+/g, " ").trim() : "",
    }));
  } catch {
    return [];
  }
}
