/**
 * The board's documents (Knowledge → Business) as a Hermes skill every agent that can load skills gets:
 * `skills/mcbot/business-files/SKILL.md`, an index of the documents, and one `references/<file>.md` per
 * document with its text. Hermes lists the skill by name and a description of at most 60 characters in
 * the system prompt (agent/skill_utils.py `SKILL_PROMPT_DESC_LIMIT`); the agent reads the index with
 * `skill_view("business-files")` and a document with `skill_view("business-files", "references/<file>.md")`
 * (tools/skills_tool.py `skill_view(name, file_path)`), only when a question needs it. Like McBot's guide
 * it sits in the `mcbot` category folder, which the board reader skips. Pure.
 */
import type { Doc } from "../contracts/graph";
import { GUIDE_CATEGORY } from "./mcbotGuide";
import { canonicalText } from "./text";
import { toYaml } from "./yaml";

export const DOCS_NAME = "business-files";
/** Under <profile>/. */
export const DOCS_DIR = `skills/${GUIDE_CATEGORY}/${DOCS_NAME}`;
export const DOCS_DESCRIPTION = "Your business's documents: read them before you answer";

/** "Price list 2026.PDF" → "price-list-2026-pdf"; never empty. */
export function docSlug(name: string): string {
  const s = name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "");
  return s || "document";
}

/** Each document's reference file, unique and in a stable order (by name, then id). */
export function docFiles(docs: readonly Doc[]): { doc: Doc; file: string }[] {
  const sorted = [...docs].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const used = new Set<string>();
  return sorted.map((doc) => {
    const base = docSlug(doc.name);
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    return { doc, file: `references/${slug}.md` };
  });
}

const size = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`);
/** The document's first words, for the index. */
const opening = (text: string) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 140 ? `${t.slice(0, 139).trimEnd()}…` : t;
};

/** The skill's files, relative to the profile; none without documents. */
export function renderDocsSkill(docs: readonly Doc[] | undefined): { path: string; content: string }[] {
  if (!docs?.length) return [];
  const files = docFiles(docs);
  const fm = { name: DOCS_NAME, description: DOCS_DESCRIPTION, version: "1.0.0", author: "McBot Studio", license: "MIT" };
  const index = [
    "# Business documents",
    "",
    `The people you work for added these documents in McBot Studio (Knowledge → Business). When a question touches what they cover, read the document first and answer from it: \`skill_view("${DOCS_NAME}", "<file>")\`. Quote it rather than guess, and say which document you used.`,
    "",
    ...files.map(({ doc, file }) => `- \`${file}\`: **${doc.name}** (${size(doc.bytes)})${doc.text.trim() ? `. Starts: ${opening(doc.text)}` : ". No text could be read from it."}`),
  ].join("\n");
  return [
    { path: `${DOCS_DIR}/SKILL.md`, content: canonicalText(`---\n${toYaml(fm)}---\n\n${index}`) },
    ...files.map(({ doc, file }) => ({ path: `${DOCS_DIR}/${file}`, content: canonicalText(`# ${doc.name}\n\n${doc.text.trim() || "(No text could be read from this file.)"}`) })),
  ];
}
