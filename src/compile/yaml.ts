import { stringify } from "yaml";

/**
 * Hermes reads config.yaml, profile.yaml and SKILL.md frontmatter as YAML 1.1
 * (hermes_yaml.py: ruamel with version (1, 1)), where bare yes/no/on/off/y/n
 * are booleans and 0755 is octal. Emitting in 1.1 mode makes the library quote
 * every such string, so a value means the same thing to Hermes as it does here.
 */
export function toYaml(value: unknown): string {
  return stringify(value, { version: "1.1", lineWidth: 0, indent: 2 });
}

/** `# ...` comment lines, one per input line. */
export function yamlComment(lines: readonly string[]): string {
  return lines.map((l) => (l ? `# ${l}` : "#")).join("\n") + "\n";
}
