/**
 * Ask McBot's proposed harness: agents with their layers (context, tools, chat apps, skills, loop)
 * and who hands work to whom. A plan is only a proposal: the app turns it into board blocks the
 * person reviews and accepts (src/app/graph/builder.ts), and compile still decides what is valid.
 *
 * The engine asks the board's own model for one (engine/builder.ts) with `builderMessages`, and
 * reads its answer with `parsePlan`; anything outside the choices given is dropped there and again
 * when the plan becomes blocks. Pure: no network, no filesystem.
 */
import { z } from "zod";

export const PlanAgentSchema = z.object({
  name: z.string().trim().min(1).max(40),
  about: z.string().trim().max(160).default(""),
  /** How it works: becomes SOUL.md (the context layer). */
  soul: z.string().trim().max(1200).default(""),
  /** Hermes library skill ids (`official/<category>/<name>`). */
  skills: z.array(z.string()).max(6).default([]),
  /** Tool catalog ids (src/app/graph/catalog.ts). */
  tools: z.array(z.string()).max(6).default([]),
  /** Chat app platform ids (src/contracts/platforms.generated.ts). */
  chatApps: z.array(z.string()).max(3).default([]),
  /** Makers it makes things with itself: "image" (pictures for posts, designs) and "video". */
  makers: z.array(z.enum(["image", "video"])).max(2).default([]),
  /** The loop layer: steps per message (agent.max_turns); absent = no limit. */
  maxSteps: z.number().int().min(1).max(10_000).nullish(),
});
export type PlanAgent = z.infer<typeof PlanAgentSchema>;

export const HarnessPlanSchema = z.object({
  /** One or two sentences on what this harness does. */
  summary: z.string().trim().max(400).default(""),
  agents: z.array(PlanAgentSchema).min(1).max(8),
  /** [from, to] by agent name: the first hands work to the second. */
  handoffs: z.array(z.tuple([z.string(), z.string()])).max(16).default([]),
});
export type HarnessPlan = z.infer<typeof HarnessPlanSchema>;

/** What the planner may pick from: the app sends its catalogs, so the engine stays catalog-free. */
export interface PlanChoices {
  tools: readonly { id: string; does: string }[];
  chatApps: readonly string[];
  skills: readonly { id: string; does: string }[];
}

export const PlanChoicesSchema = z.object({
  tools: z.array(z.object({ id: z.string().max(80), does: z.string().max(200) })).max(200),
  chatApps: z.array(z.string().max(40)).max(60),
  skills: z.array(z.object({ id: z.string().max(120), does: z.string().max(200) })).max(300),
});

export function builderMessages(request: string, choices: PlanChoices): { role: "system" | "user"; content: string }[] {
  const system = [
    "You design AI agent harnesses for McBot Studio. A harness is a small team of agents; each agent has layers:",
    "context (who it is: name, about, soul), tools, chat apps, skills, and a loop (steps per message), plus hand-offs between agents.",
    "Answer with ONE JSON object and nothing else, in this shape:",
    '{"summary":"...","agents":[{"name":"Researcher","about":"Finds sources","soul":"Two or three short lines on how it works.","skills":["official/..."],"tools":["exa"],"chatApps":["slack"],"makers":[],"maxSteps":40}],"handoffs":[["Lead","Researcher"]]}',
    "Rules: 1 to 6 agents; with 3 or more, the first is a lead that hands work to the others. Short names (1-3 words).",
    "Use only ids from these lists; leave a list empty when nothing fits. Never invent ids.",
    `Tools: ${choices.tools.map((t) => `${t.id} (${t.does})`).join("; ")}`,
    `Chat apps: ${choices.chatApps.join(", ")}`,
    `Skills: ${choices.skills.map((s) => `${s.id} (${s.does})`).join("; ")}`,
    "Add a chat app only when the request names one. Souls say how to behave, never secrets.",
    'Agents must be able to do the work, not only describe it: give "makers":["image"] to an agent that makes pictures (post images, designs, thumbnails) and "makers":["video"] to one that makes videos, and say in its soul that it makes them itself with its image or video tool. Give web search ("exa") to agents that research.',
  ].join("\n");
  return [{ role: "system", content: system }, { role: "user", content: request }];
}

/** The model's answer → a valid plan with only allowed ids, or null. Tolerates think tags and code fences. */
export function parsePlan(text: string, choices?: PlanChoices): HarnessPlan | null {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = HarnessPlanSchema.safeParse(raw);
  if (!parsed.success) return null;
  return choices ? restrictPlan(parsed.data, choices) : parsed.data;
}

/** Drop ids that are not among the choices, duplicate agents, and hand-offs to nobody. */
export function restrictPlan(plan: HarnessPlan, choices: PlanChoices): HarnessPlan {
  const tools = new Set(choices.tools.map((t) => t.id));
  const apps = new Set(choices.chatApps);
  const skills = new Set(choices.skills.map((s) => s.id));
  const seen = new Set<string>();
  const agents = plan.agents.filter((a) => {
    const k = a.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).map((a) => ({
    ...a,
    tools: [...new Set(a.tools.filter((t) => tools.has(t)))],
    chatApps: [...new Set(a.chatApps.filter((c) => apps.has(c)))],
    skills: [...new Set(a.skills.filter((s) => skills.has(s)))],
    makers: [...new Set(a.makers ?? [])],
  }));
  const names = new Set(agents.map((a) => a.name.toLowerCase()));
  const handoffs = plan.handoffs.filter(([f, t]) => f.toLowerCase() !== t.toLowerCase() && names.has(f.toLowerCase()) && names.has(t.toLowerCase()));
  return { ...plan, agents, handoffs };
}
