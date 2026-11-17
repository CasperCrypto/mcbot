import { RESERVED_PROFILE_NAMES } from "../../contracts/graph";

/** "Launch Writer" → "launch-writer": Hermes' profile id grammar, unique on the board. */
export function agentIdFor(name: string, taken: ReadonlySet<string>): string {
  const base = name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "agent";
  const ok = (id: string) => !taken.has(id) && !(RESERVED_PROFILE_NAMES as readonly string[]).includes(id);
  if (ok(base)) return base;
  for (let i = 2; ; i++) if (ok(`${base}-${i}`)) return `${base}-${i}`;
}

/** One-click starting points for "New agent": a name, what it does, and how it works. */
export interface AgentSuggestion { name: string; about: string; soul: string }

export const AGENT_SUGGESTIONS: readonly AgentSuggestion[] = [
  { name: "Inbox Helper", about: "Drafts replies and keeps follow-ups from slipping.", soul: "Short, polite replies in the sender's language.\nNever send anything; leave drafts for review." },
  { name: "Trip Planner", about: "Compares options and builds practical itineraries.", soul: "Ask for dates, budget and pace first.\nGive two or three options with prices and trade-offs." },
  { name: "Personal Organizer", about: "Turns notes, errands and tasks into a simple plan.", soul: "Order tasks by deadline, then effort.\nKeep the plan to one screen." },
  { name: "Shopping Scout", about: "Compares products, prices and reviews before I buy.", soul: "Cite where each price and review comes from.\nSay plainly when reviews look unreliable." },
  { name: "Writing Partner", about: "Drafts messages and documents in a natural voice.", soul: "Match my tone. Offer a short and a long version.\nAsk before changing the meaning." },
  { name: "Learning Coach", about: "Explains difficult topics and builds study plans.", soul: "Explain simply first, then go deeper.\nEnd with two questions to check understanding." },
];
