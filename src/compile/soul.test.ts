import { describe, expect, it } from "vitest";
import { AgentDataSchema } from "../contracts/graph";
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
});
