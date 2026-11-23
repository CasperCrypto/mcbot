import type { CostRow } from "../../contracts/api";

const DAY = 86_400_000;
/** "2026-11-23" (UTC) for a time in ms. */
export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Spend per day as a continuous run of days ending today (UTC): a day with no sessions is a zero
 * bar, so the time axis never squeezes. At least `min` days; stretched back to the first day with
 * data, up to `max`.
 */
export function dailySeries(rows: readonly CostRow[], now: number, min = 14, max = 30): CostRow[] {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const today = Date.parse(`${utcDay(now)}T00:00:00Z`);
  const first = rows.reduce((m, r) => {
    const t = Date.parse(`${r.key}T00:00:00Z`);
    return Number.isFinite(t) && t < m ? t : m;
  }, today);
  const span = Math.min(max, Math.max(min, Math.round((today - first) / DAY) + 1));
  const out: CostRow[] = [];
  for (let i = span - 1; i >= 0; i--) {
    const key = utcDay(today - i * DAY);
    out.push(byKey.get(key) ?? { key, label: key, sessions: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, usd: 0, source: "none" });
  }
  return out;
}

/** "Nov 9" for a UTC day key; "Today" for today. */
export function dayLabel(key: string, now: number): string {
  if (key === utcDay(now)) return "Today";
  const t = Date.parse(`${key}T00:00:00Z`);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : key;
}
