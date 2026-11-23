import { describe, expect, it } from "vitest";
import type { CostRow } from "../../contracts/api";
import { dailySeries, dayLabel, utcDay } from "./series";

const row = (key: string, usd: number): CostRow => ({ key, label: key, sessions: 1, inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, usd, source: "hermes" });
const NOW = Date.parse("2026-11-23T15:00:00Z");

describe("dailySeries", () => {
  it("fills the days with no spend, so the axis is continuous and ends today", () => {
    const s = dailySeries([row("2026-11-22", 2), row("2026-11-17", 1)], NOW);
    expect(s).toHaveLength(14);
    expect(s.at(-1)!.key).toBe("2026-11-23");
    expect(s[0]!.key).toBe("2026-11-10");
    expect(s.find((r) => r.key === "2026-11-22")!.usd).toBe(2);
    expect(s.find((r) => r.key === "2026-11-20")!.usd).toBe(0);
    expect(new Set(s.map((r) => r.key)).size).toBe(14);
  });

  it("reaches back to the first day with data, up to the cap", () => {
    expect(dailySeries([row("2026-11-01", 1)], NOW)).toHaveLength(23);
    expect(dailySeries([row("2026-09-01", 1)], NOW, 14, 30)).toHaveLength(30);
  });

  it("is the minimum span when there is no data", () => {
    expect(dailySeries([], NOW)).toHaveLength(14);
  });
});

describe("dayLabel", () => {
  it("names today and writes other days short", () => {
    expect(dayLabel(utcDay(NOW), NOW)).toBe("Today");
    expect(dayLabel("2026-11-09", NOW)).toBe("Nov 9");
  });
});
