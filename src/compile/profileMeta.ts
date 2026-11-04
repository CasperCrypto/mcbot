import type { AgentData } from "../contracts/graph";
import { canonicalText } from "./text";
import { toYaml } from "./yaml";

/**
 * <profile>/profile.yaml — metadata ABOUT the profile, read by
 * hermes_cli/profiles.py `read_profile_meta` (description, display_name).
 * Returns null when there is nothing to say; the profile is still identified
 * by its config.yaml and SOUL.md.
 */
export function renderProfileMeta(agent: AgentData): string | null {
  const doc: Record<string, string> = {};
  if (agent.description.trim()) doc.description = agent.description.trim();
  if (agent.displayName.trim()) doc.display_name = agent.displayName.trim();
  if (!Object.keys(doc).length) return null;
  return canonicalText(toYaml(doc));
}
