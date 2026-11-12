import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ToolDataSchema } from "../contracts/graph";
import { compiledToolsets, mcpServerEntry, mcpToolPrefix, renderConfig } from "./config";
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

describe("abilities and makers", () => {
  // The three-node board, with its agent's abilities and makers changed per case.
  const board = (agent: Record<string, unknown>, makers: { id: string; media: "image" | "video"; provider: string; model?: string }[] = []) => {
    const g = fixture("three-node.graph.json");
    Object.assign(g.nodes[0].data, agent);
    for (const m of makers) {
      g.nodes.push({ id: m.id, kind: "media", position: { x: 320, y: 200 }, data: { name: m.id, label: "", media: m.media, provider: m.provider, model: m.model ?? "" } });
      g.edges.push({ id: `e-${m.id}`, source: "n-agent", target: m.id, order: 0 });
    }
    return resolveGraph(g);
  };
  const tail = (out: string) => out.slice(out.indexOf("mcp_servers:"));

  it("leaves Hermes' default tool sets alone when nothing is chosen", () => {
    const { graph, bundles, issues } = board({});
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    expect(compiledToolsets(bundles[0]!)).toBeNull();
    expect(renderConfig(graph, bundles[0]!)).not.toContain("platform_toolsets");
  });

  it("pins chosen abilities to the cli and api_server surfaces, in catalog order, byte for byte", () => {
    const { graph, bundles } = board({ capabilities: ["memory", "web", "file"] }, [{ id: "img", media: "image", provider: "openai", model: "gpt-image-2" }]);
    expect(tail(renderConfig(graph, bundles[0]!))).toBe(
      [
        "mcp_servers:",
        "  files:",
        "    command: npx",
        "    args:",
        "      - -y",
        '      - "@modelcontextprotocol/server-filesystem"',
        "      - ${workspaceFolder}",
        "platform_toolsets:",
        "  cli:",
        "    - web",
        "    - file",
        "    - image_gen",
        "    - memory",
        "  api_server:",
        "    - web",
        "    - file",
        "    - image_gen",
        "    - memory",
        "image_gen:",
        "  provider: openai",
        "  model: gpt-image-2",
        "",
      ].join("\n"),
    );
  });

  it("turns video on with Hermes' defaults when only a video maker is wired", () => {
    const { graph, bundles } = board({}, [{ id: "vid", media: "video", provider: "fal" }]);
    const toolsets = compiledToolsets(bundles[0]!)!;
    expect(toolsets).toContain("video_gen");
    expect(toolsets).toContain("terminal");
    expect(toolsets).not.toContain("kanban");
    expect(renderConfig(graph, bundles[0]!)).toMatch(/\nvideo_gen:\n  provider: fal\n$/);
  });

  it("an empty list means no built-in tools at all (MCP servers still load)", () => {
    const { graph, bundles } = board({ capabilities: [] });
    expect(renderConfig(graph, bundles[0]!)).toContain("platform_toolsets:\n  cli: []\n");
  });

  it("refuses an unknown service and two makers of one kind on one agent", () => {
    const { issues } = board({}, [{ id: "a", media: "image", provider: "midjourney" }, { id: "b", media: "image", provider: "fal" }]);
    const errors = issues.filter((i) => i.level === "error").map((i) => i.message);
    expect(errors).toContain('Image maker "a": pick a service');
    expect(errors).toContain('Agent "triage" has 2 image makers; keep one');
  });

  it("refuses a capability Hermes does not have", () => {
    const { issues } = board({ capabilities: ["web", "teleport"] });
    expect(issues.some((i) => i.level === "error" && i.nodeId === "n-agent")).toBe(true);
  });
});

describe("chat apps", () => {
  const board = (channel: Record<string, unknown>, wireTo: string[] = ["n-agent"]) => {
    const g = fixture("three-node.graph.json");
    g.nodes.push({ id: "n-tg", kind: "channel", position: { x: 320, y: 200 }, data: { name: "tg", label: "", platform: "telegram", tokenEnv: "MCBOT_TELEGRAM_TG_TOKEN", allowedUsers: ["111"], apiBase: "", ...channel } });
    if (wireTo.length > 1) g.nodes.push({ ...g.nodes[0], id: "n-agent-2", data: { ...g.nodes[0].data, name: "second" } });
    for (const a of wireTo) g.edges.push({ id: `e-tg-${a}`, source: a, target: "n-tg", order: 0 });
    if (wireTo.length > 1) g.edges.push({ id: "e-model-2", source: "n-agent-2", target: "n-model", order: 0 });
    return resolveGraph(g);
  };

  it("writes nothing to config.yaml for a bot on api.telegram.org: its token is not config", () => {
    const { graph, bundles, issues } = board({});
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    expect(bundles[0]!.channels.map((c) => c.id)).toEqual(["n-tg"]);
    const out = renderConfig(graph, bundles[0]!);
    expect(out).not.toContain("platforms");
    expect(out).not.toContain("TELEGRAM");
  });

  it("points the bot at an own Bot API server, byte for byte", () => {
    const { graph, bundles } = board({ apiBase: "http://127.0.0.1:8081/bot" });
    expect(renderConfig(graph, bundles[0]!)).toMatch(/\nplatforms:\n  telegram:\n    extra:\n      base_url: http:\/\/127\.0\.0\.1:8081\/bot\n$/);
  });

  it("refuses one bot for two agents, and warns while nobody may message it", () => {
    expect(board({}, ["n-agent", "n-agent-2"]).issues.map((i) => i.message)).toContain("A bot answers as one agent; it is wired to 2");
    expect(board({ allowedUsers: [] }).issues).toContainEqual(expect.objectContaining({ level: "warning", nodeId: "n-tg" }));
    expect(board({ allowedUsers: ["@me"] }).issues.some((i) => i.level === "error" && i.nodeId === "n-tg")).toBe(true);
  });
});
