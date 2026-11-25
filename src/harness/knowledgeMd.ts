/**
 * Everything the agents know, as one Markdown file (Knowledge → Export): the team knowledge every
 * SOUL.md carries, the documents (their text, as the agents read it), and what each agent remembers.
 * Key names never appear (nothing here holds a key). Pure: the board and the memory in, text out.
 */
import { BRIEF_FIELDS, type Brief, type Doc, type Graph } from "../contracts/graph";
import type { AgentMemoryView } from "../contracts/api";

/** The brief's fields as people read them (the Team knowledge form's labels). */
const LABELS: Record<keyof Brief, string> = {
  who: "Who the agents work for", what: "What you do", offer: "Products and prices", customers: "Customers", goals: "Goals now",
  voice: "Voice", channels: "Where you show up", sales: "How you sell", links: "Links", notes: "Anything else",
};

export function knowledgeMarkdown(graph: Pick<Graph, "name" | "brief" | "docs" | "nodes">, memory: readonly AgentMemoryView[] = [], date = ""): string {
  const out: string[] = [`# ${graph.name.trim() || "Board"}: what the agents know`];
  if (date) out.push("", `Exported from McBot Studio on ${date}.`);
  const brief = graph.brief;
  const fields = BRIEF_FIELDS.filter((k) => (brief?.[k] ?? "").trim());
  out.push("", "## Team knowledge");
  if (fields.length) for (const k of fields) out.push("", `### ${LABELS[k]}`, "", brief![k].trim());
  else out.push("", "Nothing yet.");
  const agents = graph.nodes.filter((n) => n.kind === "agent");
  if (agents.length) {
    out.push("", "## The agents", "");
    for (const a of agents) {
      const d = a.data as { name: string; displayName?: string; description?: string };
      out.push(`- **${d.displayName?.trim() || d.name}** (\`${d.name}\`)${d.description?.trim() ? `: ${d.description.trim()}` : ""}`);
    }
  }
  const docs = [...(graph.docs ?? [])].sort((a: Doc, b: Doc) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (docs.length) {
    out.push("", "## Documents");
    for (const d of docs) out.push("", `### ${d.name}`, "", d.text.trim() || "(No text could be read from this file.)");
  }
  const remembered = memory.filter((m) => m.memory.entries.length || m.user.entries.length);
  if (remembered.length) {
    out.push("", "## What the agents remember");
    for (const m of remembered) {
      out.push("", `### ${m.displayName || m.profile}`);
      if (m.user.entries.length) out.push("", "About you:", "", ...m.user.entries.map((e) => `- ${e.replace(/\s*\n\s*/g, " ")}`));
      if (m.memory.entries.length) out.push("", "Its own notes:", "", ...m.memory.entries.map((e) => `- ${e.replace(/\s*\n\s*/g, " ")}`));
    }
  }
  return `${out.join("\n")}\n`;
}
