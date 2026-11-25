import { describe, expect, it } from "vitest";
import { AgentDataSchema, BriefSchema } from "../contracts/graph";
import { GUIDE_POINTER, WHERE_HEAD, renderSoul, renderWhere } from "./soul";

const agent = (over: object) => AgentDataSchema.parse({ name: "triage", ...over });

describe("renderSoul", () => {
  it("writes the authored soul verbatim, canonicalized, with no McBot header", () => {
    expect(renderSoul(agent({ soul: "You route tickets.\r\n\r\nBe brief.  \n\n" }))).toBe("You route tickets.\n\nBe brief.\n");
  });
  it("falls back to display name and description", () => {
    expect(renderSoul(agent({ displayName: "Triage", description: "Routes tickets." }))).toBe("# Triage\n\nRoutes tickets.\n");
  });
  it("falls back to the profile name alone", () => {
    expect(renderSoul(agent({}))).toBe("# triage\n");
  });
  it("adds the agents it hands work to, by the ID kanban_create takes", () => {
    const team = [agent({ name: "editor" }), agent({ name: "writer", displayName: "Writer", description: "Writes the posts." })];
    expect(renderSoul(agent({ soul: "You lead the launch.\n" }), team)).toBe(
      "You lead the launch.\n\n## Team\n\n"
      + "You can hand work to these agents. Give each piece of work to one of them as a task with `kanban_create` (assignee: their ID, and a body that says what done looks like), then follow it with `kanban_show`.\n\n"
      + "- `editor`\n- `writer` (Writer): Writes the posts.\n",
    );
    expect(renderSoul(agent({ displayName: "Lead" }), team.slice(0, 1))).toMatch(/^# Lead\n\n## Team\n/);
  });
  it("gives every agent the board's brief as a Shared knowledge section, before the Team section", () => {
    const brief = BriefSchema.parse({ who: "Northwind Bakery", what: "Sourdough and pastries, baked daily.", channels: "Instagram, newsletter", notes: "Closed on Mondays.\nNo nuts in anything." });
    expect(renderSoul(agent({ soul: "You write our posts.\n" }), [], brief)).toBe(
      "You write our posts.\n\n## Shared knowledge\n\nEvery agent on this team knows this. Use it in all your work.\n\n"
      + "**Who:** Northwind Bakery\n**What we do:** Sourdough and pastries, baked daily.\n**Channels:** Instagram, newsletter\n**Notes:** Closed on Mondays.\nNo nuts in anything.\n",
    );
    const withTeam = renderSoul(agent({ soul: "You lead.\n" }), [agent({ name: "writer" })], brief);
    expect(withTeam.indexOf("## Shared knowledge")).toBeLessThan(withTeam.indexOf("## Team"));
    expect(renderSoul(agent({ soul: "You lead.\n" }), [], BriefSchema.parse({}))).toBe("You lead.\n");
  });
});

describe("where an agent works", () => {
  it("names McBot, its models and tools, and the guide when it can read skills", () => {
    expect(renderWhere({ models: [{ model: "qwen3:8b", where: "on this computer" }, { model: "gpt-5", where: "through OpenAI" }], tools: ["files", "Image maker (OpenRouter)"], skills: true })).toBe(
      "## Where you work\n\n" +
      "You are an agent in McBot Studio, a desktop app where people build a team of AI agents on a board and work with them. Hermes Agent runs you. People set your model, tools and team on the board; you can't change them.\n\n" +
      "- **Model:** `qwen3:8b` on this computer; if it can't answer: `gpt-5` through OpenAI.\n" +
      "- **Tools from the board:** files, Image maker (OpenRouter).\n\n" +
      GUIDE_POINTER,
    );
  });

  it("says only what it knows: no empty facts, no guide without skills", () => {
    const text = renderWhere({ models: [{ model: " ", where: "on this computer" }], tools: [], skills: false });
    expect(text).not.toContain("Model:");
    expect(text).not.toContain("Tools from the board");
    expect(text).not.toContain("mcbot-studio");
  });

  it("comes after the agent's own text and knowledge, before its team", () => {
    const agent = AgentDataSchema.parse({ name: "lead", displayName: "Lead", soul: "Lead the work." });
    const team = [AgentDataSchema.parse({ name: "writer", displayName: "Writer", description: "Writes" })];
    const soul = renderSoul(agent, team, undefined, { models: [], tools: [], skills: true });
    expect(soul.indexOf("Lead the work.")).toBeLessThan(soul.indexOf(WHERE_HEAD));
    expect(soul.indexOf(WHERE_HEAD)).toBeLessThan(soul.indexOf("## Team"));
  });
});
