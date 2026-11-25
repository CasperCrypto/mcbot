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

function sortedRecord<T>(r: Readonly<Record<string, T>>): Record<string, T> {
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
  return { ...serverEntry(tool), ...toolFilter(tool) };
}

/**
 * Which of a server's tools reach the model (tools/mcp_tool_registration.py:251-265: `include` is a
 * whitelist, `exclude` a blacklist, exact names or fnmatch globs, include wins). Written only when set.
 */
function toolFilter(tool: ToolData): Record<string, unknown> {
  const tidy = (xs: string[] | undefined) => [...new Set((xs ?? []).map((x) => x.trim()).filter(Boolean))].sort();
  const include = tidy(tool.toolsInclude);
  const exclude = tidy(tool.toolsExclude);
  const tools: Record<string, unknown> = {};
  if (include.length) tools.include = include;
  if (exclude.length) tools.exclude = exclude;
  return Object.keys(tools).length ? { tools } : {};
}

function serverEntry(tool: ToolData): Record<string, unknown> {
  if (tool.transport === "http") {
    const entry: Record<string, unknown> = { url: tool.url };
    if (Object.keys(tool.headers).length) entry.headers = sortedRecord(tool.headers);
    // Hermes' own catalog writes these for OAuth connectors (hermes_cli/mcp_catalog.py:552).
    if (tool.auth === "oauth") entry.auth = "oauth";
    if (tool.auth === "oauth" && tool.oauth && Object.keys(tool.oauth).length) entry.oauth = sortedRecord(tool.oauth);
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
 * so a video maker alone already needs the list. So does a hand-off edge: an
 * agent gives teammates tasks with the kanban tools, which are off by default
 * outside a dispatched task (tools/kanban_tools.py `_visible`). Catalog order, no duplicates.
 * The api_server surface (McBot's own chat) is always pinned: Hermes' default there leaves out
 * clarify, computer use and speech (toolsets.py `hermes-api-server`, "no interactive UI tools"),
 * which McBot shows and answers, so an agent's abilities in McBot are the ones its board lists.
 */
export function compiledToolsets(bundle: AgentBundle, surface: "cli" | "api_server" = "cli"): Capability[] | null {
  const base = bundle.agent.data.capabilities;
  if (surface === "cli" && base === null && !bundle.video && bundle.team.length === 0) return null;
  const on = new Set<Capability>(base ?? DEFAULT_CAPABILITIES);
  if (bundle.image) on.add("image_gen");
  if (bundle.video) on.add("video_gen");
  if (bundle.team.length) on.add("kanban");
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
  // McBot's own Hermes runs agents through the gateway's runs API, which reads the api_server
  // surface (gateway/platforms/api_server.py `_get_platform_tools(config, "api_server")`); an
  // external Hermes runs them as `hermes chat` (cli). Chosen abilities apply to both; with none
  // chosen, cli keeps Hermes' default and api_server gets the board's (compiledToolsets).
  const api = compiledToolsets(bundle, "api_server")!;
  doc.platform_toolsets = toolsets ? { cli: toolsets, api_server: api } : { api_server: api };
  // Only what differs from Hermes' defaults (hermes_cli/config_defaults.py `browser`).
  const b = bundle.agent.data.browser;
  const browser: Record<string, unknown> = {};
  if (b?.show) browser.headed = true;
  if (b?.engine === "lightpanda") browser.engine = "lightpanda";
  if (b?.myLogins) browser.use_real_profile = true;
  if (Object.keys(browser).length) doc.browser = browser;
  // The loop layer: a cap on tool-calling steps per message (hermes_cli/config_defaults.py
  // `agent.max_turns`; unset = no cap). Only written when the board sets one.
  // How hard it thinks (hermes_constants.py `parse_reasoning_effort`; unset = the model's default).
  const agent: Record<string, unknown> = {};
  if (bundle.agent.data.maxSteps) agent.max_turns = bundle.agent.data.maxSteps;
  if (bundle.agent.data.reasoning) agent.reasoning_effort = bundle.agent.data.reasoning;
  if (Object.keys(agent).length) doc.agent = agent;
  // When it asks before a risky command (tools/approval_context.py `_VALID_MODES`; unset = Hermes' "smart").
  if (bundle.agent.data.approvals) doc.approvals = { mode: bundle.agent.data.approvals };
  if (bundle.image) doc.image_gen = makerEntry(bundle.image);
  if (bundle.video) doc.video_gen = makerEntry(bundle.video);
  // A chat app's token and allowed users live in the agent's .env (written by the engine, never
  // compiled). Only an own Bot API server is config: platforms.<platform>.extra.base_url
  // (gateway/config_loader.py merge_platform_sections; plugins/platforms/telegram/adapter.py).
  const servers = bundle.channels.filter((c) => c.data.apiBase);
  if (servers.length) doc.platforms = Object.fromEntries(servers.map((c) => [c.data.platform, { extra: { base_url: c.data.apiBase } }]));

  const header = yamlComment([
    `Compiled by McBot from board "${graph.name || graph.id}" (${graph.id}), agent node ${bundle.agent.id}.`,
    "McBot changes only the keys its board shows; other keys stay as you or Hermes set them.",
  ]);
  return canonicalText(header + toYaml(doc));
}
