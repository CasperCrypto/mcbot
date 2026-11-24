import { beforeEach, describe, expect, it } from "vitest";
import { addRecent, isFavorite, loadFavorites, loadRecent, RECENT_MAX, samePage, siteLogo, siteName, toggleFavorite } from "./browserStore";

const mem = new Map<string, string>();
beforeEach(() => {
  mem.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k),
  };
});

describe("the browser's favorites and recent pages", () => {
  it("knows sites by their mark", () => {
    const title = (u: string) => { const l = siteLogo(u); return l && "title" in l ? l.title : null; };
    expect(title("https://mail.google.com/mail/u/0")).toBe("Gmail");
    expect(title("https://github.com/CasperCrypto/mcbot")).toBe("GitHub");
    expect(title("https://www.youtube.com/watch?v=1")).toBe("YouTube");
    expect(siteLogo("http://localhost:3000")).toBeNull();
    expect(siteName("https://www.notion.so/team")).toBe("notion.so");
    expect(samePage("https://x.io/a/", "https://x.io/a#top")).toBe(true);
  });

  it("starts with a few favorites and keeps the person's own", () => {
    expect(loadFavorites().length).toBeGreaterThan(4);
    let list = toggleFavorite(loadFavorites(), "https://linear.app/team", "Linear");
    expect(isFavorite(list, "https://linear.app/team/")).toBe(true);
    list = toggleFavorite(list, "https://linear.app/team");
    expect(isFavorite(loadFavorites(), "https://linear.app/team")).toBe(false);
  });

  it("keeps the last pages, newest first, each once", () => {
    addRecent("https://a.io", 1);
    addRecent("https://b.io", 2);
    addRecent("https://a.io/", 3);
    addRecent("about:blank", 4);
    expect(loadRecent().map((s) => s.url)).toEqual(["https://a.io/", "https://b.io"]);
    for (let i = 0; i < 20; i++) addRecent(`https://s${i}.io`, 10 + i);
    expect(loadRecent()).toHaveLength(RECENT_MAX);
  });
});
