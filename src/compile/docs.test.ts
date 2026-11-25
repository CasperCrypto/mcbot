import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { GRAPH_SCHEMA, type Doc } from "../contracts/graph";
import { DOCS_DESCRIPTION, docFiles, docSlug, renderDocsSkill } from "./docs";
import { compile } from "./index";

const doc = (over: Partial<Doc>): Doc => ({ id: "d1", name: "Prices 2026.pdf", text: "Bread £3.\nCake £12.", bytes: 20_480, by: "Kacper", at: 1, ...over });

describe("the board's documents as a skill", () => {
  it("writes an index and one reference file per document, byte for byte", () => {
    const files = renderDocsSkill([doc({}), doc({ id: "d2", name: "Plan.docx", text: "We sell bread.", bytes: 900 })]);
    expect(files.map((f) => f.path)).toEqual([
      "skills/mcbot/business-files/SKILL.md",
      "skills/mcbot/business-files/references/plan-docx.md",
      "skills/mcbot/business-files/references/prices-2026-pdf.md",
    ]);
    expect(files[0]!.content).toBe([
      "---",
      "name: business-files",
      `description: "${DOCS_DESCRIPTION}"`,
      "version: 1.0.0",
      "author: McBot Studio",
      "license: MIT",
      "---",
      "",
      "# Business documents",
      "",
      'The people you work for added these documents in McBot Studio (Knowledge → Business). When a question touches what they cover, read the document first and answer from it: `skill_view("business-files", "<file>")`. Quote it rather than guess, and say which document you used.',
      "",
      "- `references/plan-docx.md`: **Plan.docx** (900 B). Starts: We sell bread.",
      "- `references/prices-2026-pdf.md`: **Prices 2026.pdf** (20 KB). Starts: Bread £3. Cake £12.",
      "",
    ].join("\n"));
    expect(files[2]!.content).toBe("# Prices 2026.pdf\n\nBread £3.\nCake £12.\n");
  });

  it("fits Hermes' skill index (a description of at most 60 characters) and parses as YAML 1.1", () => {
    expect(DOCS_DESCRIPTION.length).toBeLessThanOrEqual(60);
    const fm = parse(/^---\n([\s\S]*?)---\n/.exec(renderDocsSkill([doc({})])[0]!.content)![1]!, { version: "1.1" }) as Record<string, unknown>;
    expect(fm).toMatchObject({ name: "business-files", description: DOCS_DESCRIPTION });
  });

  it("gives every document its own file, in a stable order, and says when nothing could be read", () => {
    expect(docSlug("Ünïcode Résumé.PDF")).toBe("unicode-resume-pdf");
    expect(docSlug("???")).toBe("document");
    const files = docFiles([doc({ id: "b", name: "notes.txt" }), doc({ id: "a", name: "notes.txt" })]);
    expect(files.map((f) => [f.doc.id, f.file])).toEqual([["a", "references/notes-txt.md"], ["b", "references/notes-txt-2.md"]]);
    expect(renderDocsSkill([doc({ text: "  " })])[1]!.content).toBe("# Prices 2026.pdf\n\n(No text could be read from this file.)\n");
    expect(renderDocsSkill([])).toEqual([]);
    expect(renderDocsSkill(undefined)).toEqual([]);
  });

  it("goes to every agent that can load skills, and not to one that can't", () => {
    const model = { id: "m", kind: "model", position: { x: 0, y: 0 }, data: { name: "local", label: "Local", endpoint: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3:8b", apiKeyEnv: "", pricing: null } };
    const agent = (id: string, name: string, capabilities: string[] | null) => ({ id, kind: "agent", position: { x: 0, y: 0 }, data: { name, displayName: name, description: "", soul: "", skills: [], capabilities } });
    const result = compile({
      schema: GRAPH_SCHEMA, id: "b", name: "B", docs: [doc({})],
      nodes: [model, agent("a", "helper", null), agent("q", "quiet", ["web"])],
      edges: [{ id: "e1", source: "m", target: "a", order: 0 }, { id: "e2", source: "m", target: "q", order: 0 }],
    });
    const paths = result.files.map((f) => f.path);
    expect(paths).toContain("profiles/helper/skills/mcbot/business-files/SKILL.md");
    expect(paths).toContain("profiles/helper/skills/mcbot/business-files/references/prices-2026-pdf.md");
    expect(paths.some((p) => p.startsWith("profiles/quiet/skills/mcbot/business-files"))).toBe(false);
  });
});
