import { CAPABILITIES, DEFAULT_CAPABILITIES, type Capability, type Graph, type MediaNode, type ModelNode, type ToolData, type ToolNode } from "../contracts/graph";
import type { AgentBundle } from "./validate";
import { canonicalText } from "./text";
import { toYaml, yamlComment } from "./yaml";

/**
 * `providers:` key for a model node. The `mcbot-` prefix keeps it from ever
 * colliding with a Hermes built-in provider id (openrouter, anthropic, …),
 * and `custom:<key>` always targets the saved entry
 * (hermes_cli/runtime_provider_custom.py `_shadowed_by_builtin`).
 */
export function providerKey(model: ModelNode): string {
  return `mcbot-${model.data.name}`;
}

export function providerRef(model: ModelNode): string {
  return `custom:${providerKey(model)}`;
}

/**
 * Hermes registers MCP tools as mcp__<server>__<tool>, each part with
 * [^A-Za-z0-9_] folded to "_" (tools/mcp_tool_schema.py mcp_prefixed_tool_name).
 * The single-underscore form in Hermes' user docs is stale.
 */
export function mcpToolPrefix(toolName: string): string {
  return `mcp__${toolName.replace(/[^A-Za-z0-9_]/g, "_")}__`;
}

function sortedRecord(r: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.keys(r).sort().map((k) => [k, r[k]!]));
}

/** One `providers.<key>` entry in the canonical v12 shape (config_providers.py). */
function providerEntry(model: ModelNode): Record<string, unknown> {
  const entry: Record<string, unknown> = { api: model.data.baseUrl };
  if (model.data.apiKeyEnv) entry.key_env = model.data.apiKeyEnv;
  entry.default_model = model.data.model;
  entry.transport = "chat_completions";
  return entry;
}

/** One `mcp_servers.<name>` entry (website/docs/reference/mcp-config-reference.md). */
export function mcpServerEntry(tool: ToolData): Record<string, unknown> {
  if (tool.transport === "http") {
    const entry: Record<string, unknown> = { url: tool.url };
    if (Object.keys(tool.headers).length) entry.headers = sortedRecord(tool.headers);
    return entry;
  }
  const entry: Record<string, unknown> = { command: tool.command };
  if (tool.args.length) entry.args = [...tool.args];
  if (Object.keys(tool.env).length) entry.env = sortedRecord(tool.env);
  return entry;
}

/**
 * The tool sets to pin in `platform_toolsets.cli`, or null to leave Hermes'
 * default. A wired maker turns its tool set on: video_gen is off by default,
 * so a video maker alone already needs the list. Catalog order, no duplicates.
 */
export function compiledToolsets(bundle: AgentBundle): Capability[] | null {
  const base = bundle.agent.data.capabilities;
  if (base === null && !bundle.video) return null;
  const on = new Set<Capability>(base ?? DEFAULT_CAPABILITIES);
  if (bundle.image) on.add("image_gen");
  if (bundle.video) on.add("video_gen");
  return CAPABILITIES.map((c) => c.key).filter((k) => on.has(k));
}

/** `image_gen:` / `video_gen:` (agent/image_gen_registry.py, hermes_cli/web_routers/tools.py). */
function makerEntry(m: MediaNode): Record<string, unknown> {
  const entry: Record<string, unknown> = { provider: m.data.provider };
  if (m.data.model.trim()) entry.model = m.data.model.trim();
  return entry;
}

/** <profile>/config.yaml */
export function renderConfig(graph: Graph, bundle: AgentBundle): string {
  const [primary, ...fallbacks] = bundle.models;
  if (!primary) throw new Error(`agent ${bundle.agent.data.name} has no model`);

  const doc: Record<string, unknown> = {
    model: { provider: providerRef(primary), default: primary.data.model },
    providers: Object.fromEntries(bundle.models.map((m) => [providerKey(m), providerEntry(m)])),
  };
  if (fallbacks.length) {
    doc.fallback_providers = fallbacks.map((m) => ({ provider: providerRef(m), model: m.data.model }));
  }
  if (bundle.tools.length) {
    doc.mcp_servers = Object.fromEntries(bundle.tools.map((t: ToolNode) => [t.data.name, mcpServerEntry(t.data)]));
  }
  const toolsets = compiledToolsets(bundle);
  if (toolsets) doc.platform_toolsets = { cli: toolsets };
  if (bundle.image) doc.image_gen = makerEntry(bundle.image);
  if (bundle.video) doc.video_gen = makerEntry(bundle.video);
  // A chat app's token and allowed users live in the agent's .env (written by the engine, never
  // compiled). Only an own Bot API server is config: platforms.<platform>.extra.base_url
  // (gateway/config_loader.py merge_platform_sections; plugins/platforms/telegram/adapter.py).
  const servers = bundle.channels.filter((c) => c.data.apiBase);
  if (servers.length) doc.platforms = Object.fromEntries(servers.map((c) => [c.data.platform, { extra: { base_url: c.data.apiBase } }]));

  const header = yamlComment([
    `Compiled by McBot from board "${graph.name || graph.id}" (${graph.id}), agent node ${bundle.agent.id}.`,
    "Recompiling overwrites this file: change the board, not this file.",
  ]);
  return canonicalText(header + toYaml(doc));
}
