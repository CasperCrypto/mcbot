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

describe("connectors from Hermes' catalog", () => {
  it("make an http tool that signs in through Hermes", async () => {
    const { CONNECTOR_TOOLS, catalogNode: make } = await import("./catalog");
    const linear = CONNECTOR_TOOLS.find((t) => t.name === "linear");
    expect(linear).toBeTruthy();
    const n = make(linear!, new Set(), { x: 0, y: 0 });
    expect(n.data).toMatchObject({ name: "linear", transport: "http", auth: "oauth" });
    const keyless = CONNECTOR_TOOLS.find((t) => t.name === "deepwiki")!;
    expect("auth" in make(keyless, new Set(), { x: 0, y: 0 }).data).toBe(false);
  });
});
