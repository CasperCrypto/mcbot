/**
 * Ask McBot: the engine asks the board's own model (OpenAI-compatible `/chat/completions`, the
 * same endpoint its agents use; hard rule 4: no vendor SDK) for a harness plan. The key never
 * leaves the engine. The answer is only a proposal: src/harness/plan.ts keeps the allowed ids and
 * the app shows it for review before anything reaches the board.
 */
import type { Graph, ModelNode } from "../src/contracts/graph";
import { resolveGraph } from "../src/compile";
import { builderMessages, parsePlan, type HarnessPlan, type PlanChoices } from "../src/harness/plan";

/** The model the board's first agent thinks with, else the first model block. */
export function plannerModel(graph: Graph): ModelNode | null {
  const fromAgent = resolveGraph(graph).bundles.find((b) => b.models.length)?.models[0];
  return fromAgent ?? (graph.nodes.find((n): n is ModelNode => n.kind === "model") ?? null);
}

export class PlanError extends Error {}

export async function askForPlan(model: ModelNode, key: string | undefined, request: string, choices: PlanChoices, fetchImpl: typeof fetch = fetch, timeoutMs = 90_000): Promise<HarnessPlan> {
  if (model.data.endpoint === "cloud" && !key) throw new PlanError(`Save the key for ${model.data.label || model.data.name} first`);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${model.data.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      signal: ctl.signal,
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model: model.data.model, messages: builderMessages(request, choices), temperature: 0.3 }),
    });
    if (!res.ok) throw new PlanError(`${model.data.label || model.data.name} answered ${res.status}`);
    const body = (await res.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[] } | null;
    const text = body?.choices?.[0]?.message?.content;
    const plan = typeof text === "string" ? parsePlan(text, choices) : null;
    if (!plan || plan.agents.length === 0) throw new PlanError(`${model.data.label || model.data.name} didn't return a usable plan`);
    return plan;
  } catch (err) {
    if (err instanceof PlanError) throw err;
    throw new PlanError(ctl.signal.aborted ? `${model.data.label || model.data.name} took too long` : `Couldn't reach ${model.data.label || model.data.name}`);
  } finally {
    clearTimeout(t);
  }
}
