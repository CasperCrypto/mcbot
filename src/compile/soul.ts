import type { AgentData } from "../contracts/graph";
import { canonicalText } from "./text";

/**
 * <profile>/SOUL.md — injected verbatim as slot #1 of the system prompt
 * (website/docs/user-guide/which-file-does-what.md), so it carries no McBot
 * header: every byte here reaches the model.
 */
export function renderSoul(agent: AgentData): string {
  if (agent.soul.trim()) return canonicalText(agent.soul);
  const title = agent.displayName.trim() || agent.name;
  const about = agent.description.trim();
  return canonicalText(about ? `# ${title}\n\n${about}` : `# ${title}`);
}
