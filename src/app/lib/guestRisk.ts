/**
 * What a guest (Share → Can chat) could ask an agent to do on this computer: the abilities that
 * reach files, commands, the screen or other accounts, and the tools wired to it. A link for
 * guests says so before it is sent, so a customer-facing agent can be one with none of these.
 */
import { CAPABILITIES, DEFAULT_CAPABILITIES, type AgentNode, type Capability, type Graph } from "../../contracts/graph";

const RISKY: readonly Capability[] = ["file", "terminal", "code_execution", "browser", "computer_use", "connections", "delegation", "cronjob", "kanban"];

export function guestRisks(agent: AgentNode, graph: Graph): string[] {
  const caps = agent.data.capabilities ?? DEFAULT_CAPABILITIES;
  const abilities = RISKY.filter((k) => caps.includes(k)).map((k) => CAPABILITIES.find((c) => c.key === k)?.label ?? k);
  const wired = new Set(graph.edges.flatMap((e) => (e.source === agent.id ? [e.target] : e.target === agent.id ? [e.source] : [])));
  const tools = graph.nodes.filter((n) => n.kind === "tool" && wired.has(n.id)).map((n) => (n.data as { name?: string }).name ?? "a tool");
  return [...abilities, ...tools];
}
