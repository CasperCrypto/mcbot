import type { AgentNode } from "../../contracts/graph";

/** "@triage do this" → the agent and what to ask it. */
export function mentionOf(text: string, agents: readonly AgentNode[]): { agent: AgentNode; prompt: string } | null {
  const m = /^@([\w-]+)[\s,:]+([\s\S]+)$/.exec(text.trim());
  if (!m) return null;
  const want = m[1]!.toLowerCase();
  const agent = agents.find((a) => a.data.name === want || a.data.displayName.toLowerCase().replace(/\s+/g, "") === want);
  return agent ? { agent, prompt: m[2]!.trim() } : null;
}
