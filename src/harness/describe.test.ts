import { describe as group, expect, it } from "vitest";
import type { Graph } from "../contracts/graph";
import { describeHarness } from "./describe";

const g: Graph = {
  schema: "mcbot.graph/v1", id: "b", name: "Support desk",
  nodes: [
    { id: "a", kind: "agent", position: { x: 0, y: 0 }, data: { name: "researcher", displayName: "Researcher", description: "Answers from the docs.", soul: "Quote the doc.\nBe brief.", skills: [], capabilities: ["web", "file"], reasoning: "high", maxSteps: 20 } },
    { id: "w", kind: "agent", position: { x: 0, y: 0 }, data: { name: "writer", displayName: "", description: "", soul: "", skills: [], capabilities: null } },
    { id: "m1", kind: "model", position: { x: 0, y: 0 }, data: { name: "cloud", label: "", endpoint: "cloud", baseUrl: "https://openrouter.ai/api/v1", model: "anthropic/claude-sonnet-4.5", apiKeyEnv: "OPENROUTER_API_KEY", pricing: null } },
    { id: "m2", kind: "model", position: { x: 0, y: 0 }, data: { name: "local", label: "", endpoint: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3:8b", apiKeyEnv: "", pricing: null } },
    { id: "t", kind: "tool", position: { x: 0, y: 0 }, data: { name: "docs", label: "Docs search", transport: "http", command: "", args: [], env: {}, url: "https://x/mcp", headers: {}, toolsInclude: ["search"] } },
  ],
  edges: [
    { id: "e1", source: "m1", target: "a", order: 0 },
    { id: "e2", source: "a", target: "m2", order: 1 },
    { id: "e3", source: "a", target: "t", order: 0 },
    { id: "e4", source: "a", target: "w", order: 0 },
  ],
} as Graph;

group("describeHarness", () => {
  it("writes the harness as text an AI can read, keys by name only", () => {
    const text = describeHarness(g);
    expect(text).toContain("# Harness: Support desk");
    expect(text).toContain("## Researcher (`researcher`)");
    expect(text).toContain("- Thinks with: Claude Sonnet 4.5 (`anthropic/claude-sonnet-4.5`, cloud); falls back to: Qwen3 8B (`qwen3:8b`, on this computer)");
    expect(text).toContain("- Uses: Docs search (MCP `docs`, online; only search)");
    expect(text).toContain("- Hands work to: writer");
    expect(text).toContain("- Settings: thinking high; up to 20 steps per message");
    expect(text).toContain("  > Quote the doc.\n  > Be brief.");
    expect(text).toContain("## writer (`writer`)\n\n- Thinks with: no model yet");
    expect(text).not.toContain("OPENROUTER_API_KEY=");
    expect(text.endsWith("\n")).toBe(true);
  });
});
