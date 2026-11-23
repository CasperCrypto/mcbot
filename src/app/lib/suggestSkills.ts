/**
 * Skills from Hermes' library that fit an agent, for "Suggested for <agent>" in the Skills view.
 * Pure: words from what the agent is for (name, description, soul) against each skill's name,
 * tags, category and description; a starter card's own skills count most, since they were picked
 * by hand for that kind of agent (shell/agentSuggestions.ts).
 */
import type { LibrarySkill } from "../../contracts/api";
import { AGENT_SUGGESTIONS } from "../shell/agentSuggestions";

const STOP = new Set(("the and for with from your you that this into are its our what when then them they their about before after each every only just more most less "
  + "any all one two three first short plain plainly keep make makes give gives say says ask asks use uses using never always than not can how who why where which also "
  + "like been has have had was were will would should could may might must his her him she it is in on of to as at by be or if so do does done me my mine own new good "
  + "help helps helper agent agents thing things way ways out up down over under very much many some other others same well lot lots get gets let lets").split(" "));

/** "Researchers" → "research", "writing" → "writ", "images" → "imag": a light stem, so word forms meet. */
export function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.length > 4) w = w.replace(/(ies)$/, "y").replace(/(ings|ing|ers|er|ed|es|s)$/, "");
  return w.length > 3 ? w.replace(/e$/, "") : w;
}

export function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w)).map(stem);
}

export interface AgentText { name: string; description: string; soul: string }

/** Up to `n` library skills that fit the agent, best first; none already installed. */
export function suggestSkills(agent: AgentText, library: readonly LibrarySkill[], installed: ReadonlySet<string>, n = 4): LibrarySkill[] {
  const want = new Map<string, number>();
  const add = (text: string, weight: number) => { for (const w of words(text)) want.set(w, Math.max(want.get(w) ?? 0, weight)); };
  add(agent.name, 2);
  add(agent.description, 1.5);
  add(agent.soul, 0.75);
  // A starter card with this agent's name: its hand-picked skills first.
  const card = AGENT_SUGGESTIONS.find((c) => c.name.toLowerCase() === agent.name.trim().toLowerCase());
  const picked = new Set(card?.skills ?? []);
  const scored = library
    .filter((s) => !installed.has(s.name))
    .map((s) => {
      const fields: [string[], number][] = [[words(s.name.replace(/-/g, " ")), 3], [s.tags.flatMap((t) => words(t.replace(/-/g, " "))), 2], [words(s.category.replace(/-/g, " ")), 1.5], [words(s.description), 1]];
      let score = picked.has(s.id) ? 10 : 0;
      for (const [w, weight] of want) {
        const best = Math.max(0, ...fields.filter(([ws]) => ws.includes(w)).map(([, f]) => f));
        score += best * weight;
      }
      return { s, score };
    })
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name));
  return scored.slice(0, n).map((x) => x.s);
}
