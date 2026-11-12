import { describe, expect, it } from "vitest";
import { toolLabel } from "./toolLabel";

describe("toolLabel", () => {
  it("reads an MCP tool and a built-in one like words", () => {
    expect(toolLabel("mcp__docs__search")).toBe("Docs: search");
    expect(toolLabel("mcp__files__list_directory")).toBe("Files: list directory");
    expect(toolLabel("web_search")).toBe("Web search");
  });
});
