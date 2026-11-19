import { describe, expect, it } from "vitest";
import { starterPrompts } from "./starters";

describe("starterPrompts", () => {
  it("picks prompts from what the agent is for", () => {
    expect(starterPrompts("Researcher", "Finds sources and sums them up")[0]).toMatch(/news/);
    expect(starterPrompts("Coder", "Writes and reviews code")[0]).toMatch(/code/);
    expect(starterPrompts("Assistant", "Plans your day, drafts messages, keeps notes")[0]).toMatch(/Plan my day/);
  });
  it("always offers three, the same each time", () => {
    expect(starterPrompts("Zed", "")).toHaveLength(3);
    expect(starterPrompts("Zed", "")).toEqual(starterPrompts("Zed", ""));
  });
});
