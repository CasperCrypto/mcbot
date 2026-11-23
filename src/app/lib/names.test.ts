import { describe, expect, it } from "vitest";
import { BUNDLED, LIBRARY } from "../../contracts/library.generated";
import { categoryName, prettyName } from "./names";

describe("prettyName", () => {
  it("writes kebab-case names in sentence case", () => {
    expect(prettyName("agent-merge-conflict-arbiter")).toBe("Agent merge conflict arbiter");
    expect(prettyName("one_three_one_rule")).toBe("One three one rule");
    expect(prettyName("grok")).toBe("Grok");
  });

  it("keeps acronyms and brands spelled their own way", () => {
    expect(prettyName("antigravity-cli")).toBe("Antigravity CLI");
    expect(prettyName("autonomous-ai-agents")).toBe("Autonomous AI agents");
    expect(prettyName("github-pr-review")).toBe("GitHub PR review");
    expect(prettyName("mlops")).toBe("MLOps");
    expect(prettyName("devops")).toBe("DevOps");
    expect(prettyName("youtube-content")).toBe("YouTube content");
    expect(prettyName("p5js")).toBe("p5.js");
    expect(prettyName("1password")).toBe("1Password");
  });

  it("leaves a word that already has inner capitals alone", () => {
    expect(prettyName("use-OpenRouter")).toBe("Use OpenRouter");
  });

  it("gives every library and built-in skill a non-empty name", () => {
    for (const s of [...LIBRARY, ...BUNDLED]) expect(prettyName(s.name).trim()).not.toBe("");
  });
});

describe("categoryName", () => {
  it("names Hermes' category folders for people", () => {
    expect(categoryName("mcp")).toBe("MCP servers");
    expect(categoryName("dogfood")).toBe("Testing");
    expect(categoryName("smart-home")).toBe("Smart home");
    expect(categoryName("autonomous-ai-agents")).toBe("Autonomous AI agents");
  });
});
