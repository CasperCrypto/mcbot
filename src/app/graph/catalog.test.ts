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

describe("connector names", () => {
  it("spell brands their own way", async () => {
    const { titled } = await import("./catalog");
    expect(["gitlab", "deepwiki", "circleci", "n8n-official", "aws-knowledge", "microsoft-learn"].map(titled)).toEqual(["GitLab", "DeepWiki", "CircleCI", "n8n", "AWS Knowledge", "Microsoft Learn"]);
  });
});

describe("GitHub", () => {
  it("is GitHub's hosted server with the token in its header, by name only", () => {
    const node = catalogNode(CATALOG.find((t) => t.id === "github")!, new Set(), { x: 0, y: 0 });
    const data = ToolDataSchema.parse(node.data);
    expect(mcpServerEntry(data)).toEqual({ url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer ${env:GITHUB_PERSONAL_ACCESS_TOKEN}" } });
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

describe("brand tiles", () => {
  it("know each brand's colour and the ink that reads on it (near-black brands go on the dark tile)", async () => {
    const { LOGOS } = await import("../lib/logos.generated");
    const telegram = LOGOS.telegram as { tile: string | null; ink: string };
    expect(telegram.tile).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(telegram.ink).toBe("#fff");
    expect((LOGOS.github as { tile: string | null }).tile).toBeNull();
  });
});
