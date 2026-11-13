import { describe, expect, it } from "vitest";
import { ToolDataSchema } from "../../contracts/graph";
import { mcpServerEntry } from "../../compile/config";
import { CATALOG, catalogNode } from "./catalog";

describe("the tool catalog", () => {
  it("makes keyless remote search a url-only MCP server", () => {
    const exa = CATALOG.find((t) => t.id === "exa")!;
    const node = catalogNode(exa, new Set(), { x: 0, y: 0 });
    const data = ToolDataSchema.parse(node.data);
    expect(mcpServerEntry(data)).toEqual({ url: "https://mcp.exa.ai/mcp" });
  });

  it("keeps local servers on npx with their key by name only", () => {
    const node = catalogNode(CATALOG.find((t) => t.id === "brave")!, new Set(["brave"]), { x: 0, y: 0 });
    const data = ToolDataSchema.parse(node.data);
    expect(data.name).toBe("brave-2");
    expect(data.env).toEqual({ BRAVE_API_KEY: "${env:BRAVE_API_KEY}" });
  });
});
