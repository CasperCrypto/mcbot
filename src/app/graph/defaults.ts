import type { Graph, GraphNode } from "../../contracts/graph";

export function newId(prefix: string): string {
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rand}`;
}

export function uniqueName(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) if (!set.has(`${base}-${i}`)) return `${base}-${i}`;
}

const namesOf = (g: Graph, kind: GraphNode["kind"]) => g.nodes.filter((n) => n.kind === kind).map((n) => String((n.data as { name?: string }).name ?? ""));

export function newAgent(g: Graph, position: { x: number; y: number }): GraphNode {
  const name = uniqueName("agent", namesOf(g, "agent"));
  return { id: newId("agent"), kind: "agent", position, data: { name, displayName: "New agent", description: "", soul: "", skills: [] } };
}

export type ModelPreset = "local" | "cloud";

/** Both presets are OpenAI-compatible endpoints (hard rule 4: no per-vendor SDKs). */
export function newModel(g: Graph, preset: ModelPreset, position: { x: number; y: number }): GraphNode {
  const name = uniqueName(preset, namesOf(g, "model"));
  const data =
    preset === "local"
      ? { name, label: "Local model", endpoint: "local" as const, baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3:8b", apiKeyEnv: "", pricing: null }
      : { name, label: "Cloud model", endpoint: "cloud" as const, baseUrl: "https://openrouter.ai/api/v1", model: "", apiKeyEnv: "OPENROUTER_API_KEY", pricing: null };
  return { id: newId("model"), kind: "model", position, data };
}

export type ToolPreset = "filesystem" | "stdio" | "http";

/**
 * The filesystem preset gets an absolute folder: Hermes' gateway starts MCP
 * servers at boot, so ${workspaceFolder} would resolve to the gateway's
 * directory, not the agent's (observed in the e2e run).
 */
export function newTool(g: Graph, preset: ToolPreset, position: { x: number; y: number }, workspace: string | null): GraphNode {
  const taken = namesOf(g, "tool");
  const base = { label: "", env: {}, url: "", headers: {}, command: "", args: [] as string[] };
  if (preset === "filesystem") {
    const folder = workspace ? `${workspace.replace(/[\\/]+$/, "")}/files` : "/path/to/shared/files";
    return { id: newId("tool"), kind: "tool", position, data: { ...base, name: uniqueName("files", taken), label: "Shared files", transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", folder] } };
  }
  if (preset === "http") {
    return { id: newId("tool"), kind: "tool", position, data: { ...base, name: uniqueName("remote", taken), label: "Remote MCP", transport: "http", url: "https://" } };
  }
  return { id: newId("tool"), kind: "tool", position, data: { ...base, name: uniqueName("tool", taken), label: "MCP server", transport: "stdio", command: "" } };
}
