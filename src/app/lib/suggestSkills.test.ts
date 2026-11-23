import { describe, expect, it } from "vitest";
import { LIBRARY } from "../../contracts/library.generated";
import { stem, suggestSkills, words } from "./suggestSkills";

const names = (agent: { name: string; description: string; soul?: string }, installed: string[] = []) =>
  suggestSkills({ soul: "", ...agent }, LIBRARY, new Set(installed)).map((s) => s.name);

describe("suggestSkills", () => {
  it("meets word forms half way", () => {
    expect(stem("researcher")).toBe(stem("research"));
    expect(stem("writing")).toBe(stem("writer"));
    expect(stem("images")).toBe(stem("image"));
    expect(words("The agent that helps with Reddit")).toEqual(["reddit"]);
  });

  it("puts a starter card's own skills first", () => {
    const got = names({ name: "Shopping Scout", description: "Compares products, prices and reviews before I buy." });
    expect(got.slice(0, 2).sort()).toEqual(["reddit-reading", "shop"]);
  });

  it("finds skills from what an agent is for", () => {
    expect(names({ name: "Feed reader", description: "Reads RSS feeds and blogs every morning" })).toContain("rss-feeds");
    expect(names({ name: "Debugger", description: "Debugs Python services" })).toContain("python-debugpy");
  });

  it("leaves out what is installed, and suggests nothing for an agent it can't place", () => {
    expect(names({ name: "Feed reader", description: "Reads RSS feeds and blogs" }, ["rss-feeds"])).not.toContain("rss-feeds");
    expect(names({ name: "Zed", description: "" })).toEqual([]);
  });
});
