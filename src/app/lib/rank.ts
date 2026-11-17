/**
 * Ranking for the command palette (⌘K): fuzzy matching and "frecency" (how often and how
 * recently a command was used), so what you reach for most is on top, as in a launcher.
 * The matching and the scoring are pure; only `recent` touches localStorage, and tolerates it
 * being unavailable (private windows, blocked storage).
 */

/** How well `text` matches one word of the query: 0 = no match. Prefix > word start > inside > spread out. */
function wordScore(word: string, text: string, loose: boolean): number {
  const at = text.indexOf(word);
  if (at === 0) return 100;
  if (at > 0) return /[\s\-_/.@:]/.test(text[at - 1]!) ? 80 : 55;
  if (!loose || word.length < 3) return 0;
  // Letters in order, not together ("cmpl" → "Compile"): worth less the more it is spread out.
  let pos = -1;
  let first = -1;
  for (const ch of word) {
    pos = text.indexOf(ch, pos + 1);
    if (pos < 0) return 0;
    if (first < 0) first = pos;
  }
  const spread = pos - first + 1 - word.length;
  return Math.max(5, 35 - spread * 4);
}

/** Every word must match; the score is their average, so longer exact hits win. 0 = no match. */
/** `loose` also accepts letters in order ("cmpl" → "Compile"); keep it for short names, not long descriptions. */
export function fuzzyScore(query: string, text: string, loose = true): number {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const hay = text.toLowerCase();
  let sum = 0;
  for (const w of words) {
    const s = wordScore(w, hay, loose);
    if (!s) return 0;
    sum += s;
  }
  return sum / words.length;
}

export interface Use { n: number; at: number }
const DAY = 86_400_000;

/** Uses, fading with age: ten uses a month ago count about as much as two today. */
export function frecency(use: Use | undefined, now = Date.now()): number {
  if (!use) return 0;
  return use.n / (1 + (now - use.at) / (DAY * 7));
}

const KEY = "mcbot.palette.recent";
export function loadRecent(): Record<string, Use> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Use>;
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
/** Count one use of a command (ids that carry a board's own ids are fine: the list is capped). */
export function recordUse(id: string, now = Date.now()): void {
  try {
    const all = loadRecent();
    const cur = all[id];
    all[id] = { n: Math.min(50, (cur?.n ?? 0) + 1), at: now };
    const keep = Object.entries(all).sort((a, b) => frecency(b[1], now) - frecency(a[1], now)).slice(0, 80);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch {
    /* storage unavailable: ranking just stays as it was */
  }
}
