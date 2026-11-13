/**
 * Models and the agents that use them, as the board holds them: a model→agent edge whose `order`
 * is the model's place in that agent's chain (0 = main, then backups). Pure, so Settings and Home
 * share it and it is tested without a board.
 */
import type { AgentNode, Graph, GraphEdge, ModelNode } from "../../contracts/graph";

export const agentsOf = (g: Graph): AgentNode[] => g.nodes.filter((n): n is AgentNode => n.kind === "agent");
export const modelsOf = (g: Graph): ModelNode[] => g.nodes.filter((n): n is ModelNode => n.kind === "model");

/** The model edges into one agent, main first. */
export function chainOf(g: Graph, agentId: string): GraphEdge[] {
  const models = new Set(modelsOf(g).map((m) => m.id));
  return g.edges.filter((e) => e.target === agentId && models.has(e.source)).sort((a, b) => a.order - b.order);
}

/** Agents with no model at all: they cannot run until one is connected. */
export const agentsWithoutModel = (g: Graph): AgentNode[] => agentsOf(g).filter((a) => chainOf(g, a.id).length === 0);

/** Which agents use a model. */
export const usersOf = (g: Graph, modelId: string): AgentNode[] => {
  const ids = new Set(g.edges.filter((e) => e.source === modelId).map((e) => e.target));
  return agentsOf(g).filter((a) => ids.has(a.id));
};

/**
 * Connect a model to agents. `main`: it becomes each agent's first model and the others move one
 * place back; otherwise it joins the end of the chain as a backup. Agents already using it are
 * left alone. Returns the edges to add and the order changes to make.
 */
export function attachModel(g: Graph, modelId: string, agentIds: readonly string[], main: boolean, newId: () => string): { add: GraphEdge[]; reorder: { id: string; order: number }[] } {
  const add: GraphEdge[] = [];
  const reorder: { id: string; order: number }[] = [];
  for (const agentId of agentIds) {
    const chain = chainOf(g, agentId);
    if (chain.some((e) => e.source === modelId)) continue;
    if (main) {
      chain.forEach((e, i) => reorder.push({ id: e.id, order: i + 1 }));
      add.push({ id: newId(), source: modelId, target: agentId, order: 0 });
    } else {
      add.push({ id: newId(), source: modelId, target: agentId, order: chain.length ? chain.at(-1)!.order + 1 : 0 });
    }
  }
  return { add, reorder };
}

/** A local model's server, asked now: answering with the model, answering without it, or silent. */
export type ModelHealth = "ok" | "missing" | "down";

export function localHealth(model: string, served: string[] | null): ModelHealth {
  if (!served) return "down";
  // Ollama lists "qwen3:8b"; a board may say "qwen3:8b" or "qwen3" (= ":latest").
  const want = model.trim();
  return served.some((m) => m === want || m === `${want}:latest` || m.replace(/:latest$/, "") === want) ? "ok" : "missing";
}

/** Make a model the main one for every agent that uses it (the others move one place back). */
export function promoteModel(g: Graph, modelId: string): { id: string; order: number }[] {
  const out: { id: string; order: number }[] = [];
  for (const a of usersOf(g, modelId)) {
    const chain = chainOf(g, a.id);
    const mine = chain.find((e) => e.source === modelId)!;
    [mine, ...chain.filter((e) => e !== mine)].forEach((e, i) => { if (e.order !== i) out.push({ id: e.id, order: i }); });
  }
  return out;
}
