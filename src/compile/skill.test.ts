import { describe, expect, it } from "vitest";
import { SkillSchema } from "../contracts/graph";
import { renderSkill } from "./skill";

describe("renderSkill", () => {
  it("writes the full Hermes frontmatter in skills/AGENTS.md order", () => {
    const skill = SkillSchema.parse({
      name: "web-brief",
      description: "Summarize a topic into a one-page brief.",
      version: "1.2.0",
      author: "Acme Ops",
      license: "MIT",
      platforms: ["macos", "windows"],
      tags: ["research"],
      body: "# Web brief\r\n\r\nSearch, then write.\n",
    });
    expect(renderSkill(skill)).toBe(
      [
        "---",
        "name: web-brief",
        "description: Summarize a topic into a one-page brief.",
        "version: 1.2.0",
        "author: Acme Ops",
        "license: MIT",
        "platforms:",
        "  - macos",
        "  - windows",
        "metadata:",
        "  hermes:",
        "    tags:",
        "      - research",
        "---",
        "",
        "# Web brief",
        "",
        "Search, then write.",
        "",
      ].join("\n"),
    );
  });

  it("omits empty optional fields and synthesizes a body", () => {
    const skill = SkillSchema.parse({ name: "on-call", description: "Page the on-call human." });
    expect(renderSkill(skill)).toBe(
      "---\nname: on-call\ndescription: Page the on-call human.\nversion: 1.0.0\n---\n\n# on-call\n\nPage the on-call human.\n",
    );
  });

  it("quotes descriptions YAML would otherwise mangle", () => {
    const skill = SkillSchema.parse({ name: "x", description: "yes" });
    expect(renderSkill(skill)).toContain('\ndescription: "yes"\n');
  });
});
