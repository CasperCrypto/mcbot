import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ToolDataSchema } from "../contracts/graph";
import { mcpServerEntry, mcpToolPrefix, renderConfig } from "./config";
import { resolveGraph } from "./validate";

const fixture = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, "../../test/fixtures", name), "utf8"));

describe("renderConfig", () => {
  it("writes model, providers and mcp_servers for agent + local model + stdio tool, byte for byte", () => {
    const { graph, bundles } = resolveGraph(fixture("three-node.graph.json"));
    expect(renderConfig(graph, bundles[0]!)).toBe(
      [
        '# Compiled by McBot from board "Acme support desk" (acme-support), agent node n-agent.',
        "# Recompiling overwrites this file: change the board, not this file.",
        "model:",
        "  provider: custom:mcbot-local",
        "  default: qwen3:8b",
        "providers:",
        "  mcbot-local:",
        "    api: http://127.0.0.1:11434/v1",
        "    default_model: qwen3:8b",
        "    transport: chat_completions",
        "mcp_servers:",
        "  files:",
        "    command: npx",
        "    args:",
        "      - -y",
        '      - "@modelcontextprotocol/server-filesystem"',
        "      - ${workspaceFolder}",
        "",
      ].join("\n"),
    );
  });

  it("orders the chain by edge order: primary into model:, the rest into fallback_providers", () => {
    const { graph, bundles } = resolveGraph(fixture("full.graph.json"));
    const researcher = bundles.find((b) => b.agent.data.name === "researcher")!;
    const out = renderConfig(graph, researcher);
    expect(out).toContain("model:\n  provider: custom:mcbot-cloud\n  default: frontier-1\n");
    expect(out).toContain("  mcbot-cloud:\n    api: https://api.example.com/v1\n    key_env: EXAMPLE_API_KEY\n    default_model: frontier-1\n    transport: chat_completions\n");
    expect(out).toContain('fallback_providers:\n  - provider: custom:mcbot-local\n    model: "on"\n');
  });

  it("never writes a secret value, only the env var name", () => {
    const { graph, bundles } = resolveGraph(fixture("full.graph.json"));
    for (const b of bundles) expect(renderConfig(graph, b)).not.toMatch(/api_key:/);
  });
});

describe("mcpServerEntry", () => {
  it("emits url + sorted headers for http servers and drops stdio fields", () => {
    const t = ToolDataSchema.parse({ name: "s", transport: "http", url: "https://x/mcp", command: "ignored", headers: { b: "2", a: "1" } });
    expect(mcpServerEntry(t)).toEqual({ url: "https://x/mcp", headers: { a: "1", b: "2" } });
    expect(Object.keys(mcpServerEntry(t).headers as object)).toEqual(["a", "b"]);
  });
  it("omits empty args and env", () => {
    expect(mcpServerEntry(ToolDataSchema.parse({ name: "s", transport: "stdio", command: "srv" }))).toEqual({ command: "srv" });
  });
});

describe("mcpToolPrefix", () => {
  it("matches Hermes' registered name mcp__<server>__<tool>", () => {
    expect(mcpToolPrefix("files")).toBe("mcp__files__");
    expect(mcpToolPrefix("my-api")).toBe("mcp__my_api__");
    expect(mcpToolPrefix("git_ops")).toBe("mcp__git_ops__");
  });
});
