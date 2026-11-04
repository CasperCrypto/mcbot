import type { Skill } from "../contracts/graph";
import { canonicalText } from "./text";
import { toYaml } from "./yaml";

/**
 * <profile>/skills/<name>/SKILL.md. Frontmatter fields and nesting follow
 * skills/AGENTS.md: name, description, version, author, license, platforms,
 * metadata.hermes.tags. Optional fields are omitted when empty.
 */
export function renderSkill(skill: Skill): string {
  const fm: Record<string, unknown> = {
    name: skill.name,
    description: skill.description,
    version: skill.version,
  };
  if (skill.author.trim()) fm.author = skill.author.trim();
  if (skill.license.trim()) fm.license = skill.license.trim();
  if (skill.platforms.length) fm.platforms = [...skill.platforms];
  if (skill.tags.length) fm.metadata = { hermes: { tags: [...skill.tags] } };

  const body = skill.body.trim() || `# ${skill.name}\n\n${skill.description}`;
  return canonicalText(`---\n${toYaml(fm)}---\n\n${body}`);
}
