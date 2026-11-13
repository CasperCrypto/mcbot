/**
 * Search past conversations (⌘K): every word must appear in what was asked or answered.
 * Newest first, with a short snippet around the first hit in the answer (else the question).
 */
import type { RunSummary } from "../../contracts/run";

export interface RunHit {
  run: RunSummary;
  /** A line of context around the match. */
  snippet: string;
}

const clip = (text: string, at: number, width = 90): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= width) return flat;
  const start = Math.max(0, Math.min(at - 30, flat.length - width));
  return `${start > 0 ? "…" : ""}${flat.slice(start, start + width).trim()}${start + width < flat.length ? "…" : ""}`;
};

export function searchRuns(runs: Iterable<RunSummary>, query: string, limit = 8): RunHit[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
  if (words.join("").length < 2) return [];
  const hits: RunHit[] = [];
  for (const run of [...runs].sort((a, b) => b.startedAt - a.startedAt)) {
    const prompt = run.prompt.toLowerCase();
    const text = (run.text || run.error || "").toLowerCase();
    if (!words.every((w) => prompt.includes(w) || text.includes(w))) continue;
    const inText = text.indexOf(words[0]!);
    const flatText = (run.text || run.error || "").replace(/\s+/g, " ");
    hits.push({ run, snippet: inText >= 0 ? clip(flatText, flatText.toLowerCase().indexOf(words[0]!)) : clip(run.prompt, 0) });
    if (hits.length >= limit) break;
  }
  return hits;
}
