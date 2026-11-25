import { PLATFORMS, type Graph, type GraphNode, type PlatformId } from "../../contracts/graph";

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
  return { id: newId("agent"), kind: "agent", position, data: { name, displayName: "New agent", description: "", soul: "", skills: [], capabilities: null } };
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
 * An Obsidian vault is a folder of Markdown notes, so the vault block is the
 * filesystem MCP server limited to that folder: connected agents can list, read,
 * search and write notes there and nowhere else.
 */
export function newVault(g: Graph, folder: string, position: { x: number; y: number }): GraphNode {
  const name = uniqueName("obsidian", namesOf(g, "tool"));
  return {
    id: newId("tool"), kind: "tool", position,
    data: { name, label: "Obsidian", transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", folder.trim().replace(/[\\/]+$/, "")], env: {}, url: "", headers: {} },
  };
}

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

/** An image or video maker; OpenRouter first, since one OpenRouter key also runs cloud models. */
export function newMaker(g: Graph, media: "image" | "video", position: { x: number; y: number }): GraphNode {
  const name = uniqueName(media === "image" ? "images" : "videos", namesOf(g, "media"));
  return { id: newId("maker"), kind: "media", position, data: { name, label: media === "image" ? "Images" : "Videos", media, provider: "openrouter", model: "" } };
}

/** A chat app bot (one per agent and app). Its secrets are saved under names of its own (`channelKeyName`), so two agents can have two bots. */
export function newChannel(g: Graph, platform: PlatformId, position: { x: number; y: number }): GraphNode {
  const name = uniqueName(platform.replace(/_/g, "-"), namesOf(g, "channel"));
  return { id: newId("chat"), kind: "channel", position, data: { name, label: PLATFORMS[platform].label, platform, tokenEnv: "", settings: {}, allowedUsers: [], apiBase: "" } };
}

/**
 * A copy of a block beside the original (right-click → Duplicate, ⌘D): a new id, a free name of its
 * kind, "copy" in its title, everything else the same. Wires are not copied: the copy starts alone.
 */
/**
 * A display name no other agent on the board shows: "Writer", else "Writer 2", "Writer 3"… (as a
 * Mac names a second folder). `also` holds names given in the same change, not on the board yet.
 */
export function freeDisplayName(g: Graph, wanted: string, also: Iterable<string> = []): string {
  const taken = new Set([...g.nodes.filter((n) => n.kind === "agent").map((n) => String(n.data.displayName || n.data.name)), ...also].map((x) => x.trim().toLowerCase()));
  const base = wanted.trim();
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

export function duplicateNode(g: Graph, node: GraphNode): GraphNode {
  const data = structuredClone(node.data) as Record<string, unknown>;
  const base = String(data.name ?? node.kind).replace(/-copy(-\d+)?$/, "");
  data.name = uniqueName(`${base}-copy`, namesOf(g, node.kind));
  if (node.kind === "agent" && typeof data.displayName === "string" && data.displayName) data.displayName = freeDisplayName(g, String(data.displayName).replace(/ \d+$/, ""));
  if (node.kind !== "agent" && typeof data.label === "string" && data.label) data.label = `${data.label} copy`;
  return { ...node, id: newId(node.kind), position: { x: node.position.x + 44, y: node.position.y + 44 }, data } as GraphNode;
}
