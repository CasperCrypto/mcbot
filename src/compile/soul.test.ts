import { describe, expect, it } from "vitest";
import { AgentDataSchema, BriefSchema } from "../contracts/graph";
import { renderSoul } from "./soul";

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
