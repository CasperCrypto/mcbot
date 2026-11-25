import { describe, expect, it } from "vitest";
import type { AgentMemoryView } from "../contracts/api";
import { BriefSchema } from "../contracts/graph";
import { knowledgeMarkdown } from "./knowledgeMd";

const file = (target: "memory" | "user", entries: string[]) => ({ target, path: "", exists: true, entries, chars: 0, limit: 0, sha256: null });
const memory: AgentMemoryView[] = [
  { profile: "writer", nodeId: "w", displayName: "Writer", compiled: true, busy: false, memory: file("memory", ["Posts go out at 9am"]), user: file("user", ["Prefers short\ncaptions"]) },
  { profile: "quiet", nodeId: "q", displayName: "Quiet", compiled: true, busy: false, memory: file("memory", []), user: file("user", []) },
];

describe("the board's knowledge as Markdown", () => {
  it("has the team knowledge, the agents, the documents and what each agent remembers", () => {
    const md = knowledgeMarkdown({
      name: "Northwind",
      brief: BriefSchema.parse({ who: "Northwind Bakery", goals: "Sell out by noon." }),
      docs: [{ id: "d", name: "prices.pdf", text: "Bread £3", bytes: 10, by: "", at: 0 }],
      nodes: [{ id: "w", kind: "agent", position: { x: 0, y: 0 }, data: { name: "writer", displayName: "Writer", description: "Writes posts", soul: "", skills: [], capabilities: null } }],
    }, memory, "2026-11-25");
    expect(md).toBe([
      "# Northwind: what the agents know",
      "",
      "Exported from McBot Studio on 2026-11-25.",
      "",
      "## Team knowledge",
      "",
      "### Who the agents work for",
      "",
      "Northwind Bakery",
      "",
      "### Goals now",
      "",
      "Sell out by noon.",
      "",
      "## The agents",
      "",
      "- **Writer** (`writer`): Writes posts",
      "",
      "## Documents",
      "",
      "### prices.pdf",
      "",
      "Bread £3",
      "",
      "## What the agents remember",
      "",
      "### Writer",
      "",
      "About you:",
      "",
      "- Prefers short captions",
      "",
      "Its own notes:",
      "",
      "- Posts go out at 9am",
      "",
    ].join("\n"));
  });

  it("says when there is nothing yet", () => {
    expect(knowledgeMarkdown({ name: "", nodes: [] })).toBe("# Board: what the agents know\n\n## Team knowledge\n\nNothing yet.\n");
  });
});
