import type { AgentData } from "../contracts/graph";
import { canonicalText } from "./text";

/**
 * <profile>/SOUL.md — injected verbatim as slot #1 of the system prompt
 * (website/docs/user-guide/which-file-does-what.md), so it carries no McBot
 * header: every byte here reaches the model.
 *
 * An agent with hand-off edges also gets a "Team" section: who it can give work
 * to, by profile ID, which is the `assignee` of Hermes' `kanban_create` tool
 * (tools/kanban_tools_schemas.py). Its tasks then run as those agents.
 */
export function renderSoul(agent: AgentData, team: readonly AgentData[] = []): string {
  const title = agent.displayName.trim() || agent.name;
  const about = agent.description.trim();
  const own = agent.soul.trim() ? agent.soul.trim() : about ? `# ${title}\n\n${about}` : `# ${title}`;
  if (team.length === 0) return canonicalText(agent.soul.trim() ? agent.soul : own);
  const lines = team.map((t) => {
    const name = t.displayName.trim();
    const what = t.description.trim();
    return `- \`${t.name}\`${name && name !== t.name ? ` (${name})` : ""}${what ? `: ${what}` : ""}`;
  });
  return canonicalText([
    own,
    "## Team",
    "You can hand work to these agents. Give each piece of work to one of them as a task with `kanban_create` (assignee: their ID, and a body that says what done looks like), then follow it with `kanban_show`.",
    lines.join("\n"),
  ].join("\n\n"));
}
