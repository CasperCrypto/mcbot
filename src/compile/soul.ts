import { briefHasContent, type AgentData, type Brief } from "../contracts/graph";
import { canonicalText } from "./text";

/** The brief's fields as SOUL.md labels them, in this order (src/harness/read.ts reads them back). */
export const BRIEF_LABELS: readonly [keyof Brief, string][] = [
  ["who", "Who"], ["what", "What we do"], ["offer", "Offer"], ["customers", "Customers"], ["goals", "Goals now"],
  ["voice", "Voice"], ["channels", "Channels"], ["sales", "How we sell"], ["links", "Links"], ["notes", "Notes"],
];
export const KNOWLEDGE_HEAD = "## Shared knowledge";
export const KNOWLEDGE_INTRO = "Every agent on this team knows this. Use it in all your work.";

/** The board's brief as SOUL.md's "Shared knowledge" section, or null when it says nothing. */
export function renderKnowledge(brief: Brief | undefined): string | null {
  if (!brief || !briefHasContent(brief)) return null;
  const lines = BRIEF_LABELS.filter(([k]) => brief[k].trim()).map(([k, label]) => `**${label}:** ${brief[k].trim()}`);
  return [KNOWLEDGE_HEAD, KNOWLEDGE_INTRO, lines.join("\n")].join("\n\n");
}

/**
 * <profile>/SOUL.md — injected verbatim as slot #1 of the system prompt
 * (website/docs/user-guide/which-file-does-what.md), so it carries no McBot
 * header: every byte here reaches the model.
 *
 * A board with a brief gives every agent a "Shared knowledge" section after its
 * own text (renderKnowledge). An agent with hand-off edges also gets a "Team"
 * section, always last: who it can give work to, by profile ID, which is the `assignee` of Hermes' `kanban_create` tool
 * (tools/kanban_tools_schemas.py). Its tasks then run as those agents.
 */
export function renderSoul(agent: AgentData, team: readonly AgentData[] = [], brief?: Brief): string {
  const title = agent.displayName.trim() || agent.name;
  const about = agent.description.trim();
  const own = agent.soul.trim() ? agent.soul.trim() : about ? `# ${title}\n\n${about}` : `# ${title}`;
  const knowledge = renderKnowledge(brief);
  if (team.length === 0 && !knowledge) return canonicalText(agent.soul.trim() ? agent.soul : own);
  const lines = team.map((t) => {
    const name = t.displayName.trim();
    const what = t.description.trim();
    return `- \`${t.name}\`${name && name !== t.name ? ` (${name})` : ""}${what ? `: ${what}` : ""}`;
  });
  // The agent's own text, then what the whole team knows, then (always last) who it hands work to.
  return canonicalText([
    own,
    ...(knowledge ? [knowledge] : []),
    ...(team.length ? [
      "## Team",
      "You can hand work to these agents. Give each piece of work to one of them as a task with `kanban_create` (assignee: their ID, and a body that says what done looks like), then follow it with `kanban_show`.",
      lines.join("\n"),
    ] : []),
  ].join("\n\n"));
}
