import { describe, expect, it } from "vitest";
import { GRAPH_SCHEMA } from "../contracts/graph";
import { compile } from "./index";
import { GUIDE_DESCRIPTION, GUIDE_NAME, GUIDE_PATH, renderMcbotGuide } from "./mcbotGuide";
import { parse } from "yaml";

describe("McBot's guide for every agent", () => {
  it("fits Hermes' skill index: a description of at most 60 characters (agent/skill_utils.py SKILL_PROMPT_DESC_LIMIT)", () => {
    expect(GUIDE_DESCRIPTION.length).toBeLessThanOrEqual(60);
    const text = renderMcbotGuide();
    const fm = parse(/^---\n([\s\S]*?)---\n/.exec(text)![1]!, { version: "1.1" }) as Record<string, unknown>;
    expect(fm).toMatchObject({ name: GUIDE_NAME, description: GUIDE_DESCRIPTION });
    expect(text.endsWith("\n") && !text.endsWith("\n\n")).toBe(true);
  });

  it("is compiled into an agent that can load skills, in a category folder, and not into one that can't", () => {
    const model = { id: "m", kind: "model", position: { x: 0, y: 0 }, data: { name: "local", label: "Local", endpoint: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3:8b", apiKeyEnv: "", pricing: null } };
    const agent = (id: string, name: string, capabilities: string[] | null) => ({ id, kind: "agent", position: { x: 0, y: 0 }, data: { name, displayName: name, description: "", soul: "", skills: [], capabilities } });
    const result = compile({ schema: GRAPH_SCHEMA, id: "b", name: "B", nodes: [model, agent("a", "helper", null), agent("b", "quiet", ["web"])], edges: [{ id: "e1", source: "m", target: "a", order: 0 }, { id: "e2", source: "m", target: "b", order: 0 }] });
    const paths = result.files.map((f) => f.path);
    expect(paths).toContain(`profiles/helper/${GUIDE_PATH}`);
    expect(paths).not.toContain(`profiles/quiet/${GUIDE_PATH}`);
    expect(GUIDE_PATH).toBe("skills/mcbot/mcbot-studio/SKILL.md");
    expect(result.files.find((f) => f.path === "profiles/helper/SOUL.md")!.content).toContain("load the `mcbot-studio` skill");
    expect(result.files.find((f) => f.path === "profiles/quiet/SOUL.md")!.content).not.toContain("mcbot-studio");
  });
});
