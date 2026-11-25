import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { DOC_TEXT_MAX } from "../src/contracts/graph";
import { docKind, docText, freePath, safeDocName } from "./knowledge";

describe("documents for the agents", () => {
  it("knows which files it can read, and how", () => {
    expect(docKind("notes.MD")).toBe("text");
    expect(docKind("prices.csv")).toBe("text");
    expect(docKind("plan.pdf")).toBe("document");
    expect(docKind("deck.pptx")).toBe("document");
    expect(docKind("photo.png")).toBeNull();
    expect(docKind("tool.exe")).toBeNull();
  });

  it("keeps only a file name, never a folder or a control character", () => {
    expect(safeDocName("../../etc/passwd")).toBe("passwd");
    expect(safeDocName("C:\\Users\\me\\plan.pdf")).toBe("plan.pdf");
    expect(safeDocName("in\u0007voice?.pdf")).toBe("invoice.pdf");
    expect(safeDocName(".hidden")).toBe("hidden");
    expect(safeDocName("")).toBe("document.txt");
  });

  it("never saves over an earlier document", () => {
    const taken = new Set([join("/k", "plan.pdf"), join("/k", "plan (2).pdf")]);
    expect(freePath("/k", "plan.pdf", (p) => taken.has(p))).toBe(join("/k", "plan (3).pdf"));
    expect(freePath("/k", "new.md", (p) => taken.has(p))).toBe(join("/k", "new.md"));
  });

  it("keeps the text clean and within the board's limit", () => {
    expect(docText("\uFEFFa\r\nb\rc")).toEqual({ text: "a\nb\nc", truncated: false });
    const long = docText("x".repeat(DOC_TEXT_MAX + 5));
    expect(long.text.length).toBe(DOC_TEXT_MAX);
    expect(long.truncated).toBe(true);
  });
});
