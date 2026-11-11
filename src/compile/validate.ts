import {
  EdgeSchema,
  GraphSchema,
  MEDIA_PROVIDERS,
  NodeSchema,
  RESERVED_PROFILE_NAMES,
  type AgentNode,
  type ChannelNode,
  type Graph,
  type GraphNode,
  type MediaNode,
  type ModelNode,
  type ToolNode,
} from "../contracts/graph";

export interface Issue {
  level: "error" | "warning";
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface AgentBundle {
  agent: AgentNode;
  /** Primary first, then the fallback chain, by edge order then edge id. */
  models: ModelNode[];
  /** Sorted by tool name. */
  tools: ToolNode[];
  /** The image maker and the video maker wired to this agent (one each at most). */
  image: MediaNode | null;
  video: MediaNode | null;
  /** Chat apps this agent answers in (one bot per app), by platform. */
  channels: ChannelNode[];
  /** Agents this one hands work to (agent → agent edges, as kanban tasks), by name. */
  team: AgentNode[];
}

export interface Resolved {
  graph: Graph;
  bundles: AgentBundle[];
  issues: Issue[];
}

const PAIRS = new Set(["agent:model", "model:agent", "agent:tool", "tool:agent", "agent:media", "media:agent", "agent:channel", "channel:agent", "agent:agent"]);

function label(n: GraphNode): string {
  const kind = n.kind === "media" ? `${n.data.media} maker` : n.kind === "channel" ? "chat app" : n.kind;
  return n.data.name ? `${kind} "${n.data.name}"` : `${kind} ${n.id}`;
}

function duplicates<T>(items: readonly T[], key: (t: T) => string): Map<string, T[]> {
  const seen = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    seen.set(k, [...(seen.get(k) ?? []), it]);
  }
  return new Map([...seen].filter(([, v]) => v.length > 1));
}

/**
 * Parse with the schema, then check everything the schema cannot: wiring,
 * uniqueness, and the per-kind rules Hermes needs. Bundles are returned even
 * when there are errors so the UI can show partial state; compile() refuses
 * to emit anything while any error remains.
 */
export function resolveGraph(input: unknown): Resolved {
  const parsed = GraphSchema.safeParse(input);
  if (parsed.success) return resolveValid(parsed.data, []);
  const raw = (input ?? {}) as { nodes?: unknown; edges?: unknown };
  const nodeAt = (path: PropertyKey[]) => {
    const n = path[0] === "nodes" && Array.isArray(raw.nodes) ? (raw.nodes[path[1] as number] as { id?: unknown } | undefined) : undefined;
    return typeof n?.id === "string" ? { nodeId: n.id } : {};
  };
  const issues = parsed.error.issues.map<Issue>((i) => ({ level: "error", message: describe(i.path, i.message, raw), ...nodeAt(i.path) }));
  // One half-filled node must not hide the rest of the board: resolve every node and edge that is
  // valid on its own, so the views still see the agents and their models. Compile still refuses,
  // because these issues are errors.
  const shell = GraphSchema.omit({ nodes: true, edges: true }).safeParse(input);
  if (!shell.success || !Array.isArray(raw.nodes)) return { graph: input as Graph, bundles: [], issues };
  const nodes = raw.nodes.flatMap((n) => {
    const r = NodeSchema.safeParse(n);
    return r.success ? [r.data] : [];
  });
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (Array.isArray(raw.edges) ? raw.edges : []).flatMap((e) => {
    const r = EdgeSchema.safeParse(e);
    return r.success && ids.has(r.data.source) && ids.has(r.data.target) ? [r.data] : [];
  });
  return { ...resolveValid({ ...shell.data, nodes, edges }, issues), graph: input as Graph };
}

const KIND: Record<string, string> = { agent: "Agent", model: "Model", tool: "Tool", media: "Maker", channel: "Chat app" };
const FIELD: Record<string, string> = {
  name: "ID", displayName: "Name", description: "Description", soul: "Soul", model: "Model", baseUrl: "Endpoint",
  apiKeyEnv: "API key", label: "Label", command: "Command", url: "URL", transport: "Transport", skills: "Skills",
  capabilities: "Abilities", provider: "Service", media: "Kind", allowedUsers: "Allowed users", tokenEnv: "Bot token", apiBase: "Bot API server",
};

/** A schema problem in words a person can act on: which node, which field, what is wrong. */
function describe(path: PropertyKey[], message: string, raw: { nodes?: unknown }): string {
  const required = /expected string to have >=1|received undefined|^Required$/i.test(message);
  if (path[0] === "nodes" && typeof path[1] === "number" && Array.isArray(raw.nodes)) {
    const n = raw.nodes[path[1]] as { id?: unknown; kind?: unknown; data?: Record<string, unknown> } | undefined;
    const who = [n?.data?.displayName, n?.data?.label, n?.data?.name, n?.id].find((v) => typeof v === "string" && v.trim()) ?? `#${path[1]}`;
    const field = path[2] === "data" && typeof path[3] === "string" ? FIELD[path[3]] ?? path[3] : null;
    const what = field ? (required ? `${field} is required` : `${field}: ${message}`) : message;
    return `${KIND[String(n?.kind)] ?? "Node"} "${String(who)}": ${what}`;
  }
  return `${path.join(".") || "graph"}: ${message}`;
}

function resolveValid(graph: Graph, issues: Issue[]): Resolved {
  const byId = new Map<string, GraphNode>();

  for (const [id] of duplicates(graph.nodes, (n) => n.id)) issues.push({ level: "error", nodeId: id, message: `Duplicate node id ${id}` });
  for (const [id] of duplicates(graph.edges, (e) => e.id)) issues.push({ level: "error", edgeId: id, message: `Duplicate edge id ${id}` });
  for (const n of graph.nodes) byId.set(n.id, n);

  const agents = graph.nodes.filter((n): n is AgentNode => n.kind === "agent");
  const models = graph.nodes.filter((n): n is ModelNode => n.kind === "model");
  const tools = graph.nodes.filter((n): n is ToolNode => n.kind === "tool");
  const makers = graph.nodes.filter((n): n is MediaNode => n.kind === "media");
  const channels = graph.nodes.filter((n): n is ChannelNode => n.kind === "channel");

  for (const [name, ns] of duplicates(agents, (n) => n.data.name))
    for (const n of ns) issues.push({ level: "error", nodeId: n.id, message: `Two agents are named "${name}"; agent IDs must be unique` });
  for (const [name, ns] of duplicates(models, (n) => n.data.name))
    for (const n of ns) issues.push({ level: "error", nodeId: n.id, message: `Two models are named "${name}"` });
  for (const [name, ns] of duplicates(tools, (n) => n.data.name))
    for (const n of ns) issues.push({ level: "error", nodeId: n.id, message: `Two tools are named "${name}"` });
  for (const [name, ns] of duplicates(makers, (n) => n.data.name))
    for (const n of ns) issues.push({ level: "error", nodeId: n.id, message: `Two makers are named "${name}"` });
  for (const [name, ns] of duplicates(channels, (n) => n.data.name))
    for (const n of ns) issues.push({ level: "error", nodeId: n.id, message: `Two chat apps are named "${name}"` });
  for (const c of channels) {
    if (c.data.allowedUsers.length === 0)
      issues.push({ level: "warning", nodeId: c.id, message: `${label(c)}: add your user id, or nobody can message it` });
  }

  for (const a of agents) {
    if (RESERVED_PROFILE_NAMES.includes(a.data.name))
      issues.push({ level: "error", nodeId: a.id, message: `"${a.data.name}" is reserved and cannot be an agent ID` });
    for (const [name] of duplicates(a.data.skills, (s) => s.name))
      issues.push({ level: "error", nodeId: a.id, message: `Agent "${a.data.name}" has two skills named "${name}"` });
  }
  for (const m of models) {
    if (m.data.endpoint === "cloud" && !m.data.apiKeyEnv)
      issues.push({ level: "error", nodeId: m.id, message: `Cloud model "${m.data.name}" needs the name of the env var that holds its API key` });
    if (m.data.endpoint === "cloud" && m.data.baseUrl.startsWith("http://"))
      issues.push({ level: "warning", nodeId: m.id, message: `Cloud model "${m.data.name}" uses plain http` });
  }
  for (const t of tools) {
    if (t.data.transport === "stdio" && !t.data.command.trim())
      issues.push({ level: "error", nodeId: t.id, message: `Tool "${t.data.name}" (stdio) needs a command` });
    if (t.data.transport === "http" && !/^https?:\/\/\S+$/.test(t.data.url))
      issues.push({ level: "error", nodeId: t.id, message: `Tool "${t.data.name}" (http) needs an http(s) URL` });
  }

  for (const m of makers) {
    if (!Object.hasOwn(MEDIA_PROVIDERS[m.data.media], m.data.provider))
      issues.push({ level: "error", nodeId: m.id, message: `${m.data.media === "image" ? "Image" : "Video"} maker "${m.data.name}": pick a service` });
  }

  const modelEdges = new Map<string, { edgeId: string; order: number; model: ModelNode }[]>();
  const toolEdges = new Map<string, ToolNode[]>();
  const mediaEdges = new Map<string, MediaNode[]>();
  const channelEdges = new Map<string, ChannelNode[]>();
  const channelOwners = new Map<string, AgentNode[]>();
  const handoffs = new Map<string, AgentNode[]>();
  const wired = new Set<string>();
  const pairSeen = new Set<string>();

  for (const e of graph.edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) {
      issues.push({ level: "error", edgeId: e.id, message: `Edge ${e.id} points at a node that does not exist` });
      continue;
    }
    if (!PAIRS.has(`${s.kind}:${t.kind}`)) {
      issues.push({ level: "error", edgeId: e.id, message: `Cannot connect ${label(s)} to ${label(t)}; wire models, tools, makers and chat apps to agents` });
      continue;
    }
    // agent → agent: the source hands work to the target. Direction matters, so a→b and b→a are two edges.
    if (s.kind === "agent" && t.kind === "agent") {
      const pair = `${s.id}>${t.id}`;
      if (s.id === t.id) issues.push({ level: "error", edgeId: e.id, message: `${label(s)} cannot hand work to itself` });
      else if (pairSeen.has(pair)) issues.push({ level: "error", edgeId: e.id, message: `${label(s)} hands work to ${label(t)} twice` });
      else {
        pairSeen.add(pair);
        handoffs.set(s.id, [...(handoffs.get(s.id) ?? []), t]);
      }
      continue;
    }
    const agent = (s.kind === "agent" ? s : t) as AgentNode;
    const other = s.kind === "agent" ? t : s;
    const pair = `${agent.id}|${other.id}`;
    if (pairSeen.has(pair)) {
      issues.push({ level: "error", edgeId: e.id, message: `${label(agent)} is connected to ${label(other)} twice` });
      continue;
    }
    pairSeen.add(pair);
    wired.add(other.id);
    if (other.kind === "model") {
      modelEdges.set(agent.id, [...(modelEdges.get(agent.id) ?? []), { edgeId: e.id, order: e.order, model: other }]);
    } else if (other.kind === "tool") {
      toolEdges.set(agent.id, [...(toolEdges.get(agent.id) ?? []), other]);
    } else if (other.kind === "media") {
      mediaEdges.set(agent.id, [...(mediaEdges.get(agent.id) ?? []), other]);
    } else if (other.kind === "channel") {
      channelEdges.set(agent.id, [...(channelEdges.get(agent.id) ?? []), other]);
      channelOwners.set(other.id, [...(channelOwners.get(other.id) ?? []), agent]);
    }
  }

  const bundles: AgentBundle[] = [];
  for (const agent of agents) {
    const chain = (modelEdges.get(agent.id) ?? [])
      .slice()
      .sort((x, y) => x.order - y.order || (x.edgeId < y.edgeId ? -1 : x.edgeId > y.edgeId ? 1 : 0))
      .map((x) => x.model);
    if (chain.length === 0)
      issues.push({ level: "error", nodeId: agent.id, message: `Agent "${agent.data.name}" has no model; wire a model node to it` });
    const agentTools = (toolEdges.get(agent.id) ?? []).slice().sort((x, y) => (x.data.name < y.data.name ? -1 : x.data.name > y.data.name ? 1 : 0));
    // Hermes has one provider per kind (image_gen.provider, video_gen.provider).
    const maker = (kind: "image" | "video"): MediaNode | null => {
      const wiredMakers = (mediaEdges.get(agent.id) ?? []).filter((m) => m.data.media === kind);
      if (wiredMakers.length > 1)
        issues.push({ level: "error", nodeId: agent.id, message: `Agent "${agent.data.name}" has ${wiredMakers.length} ${kind} makers; keep one` });
      return wiredMakers.length === 1 ? wiredMakers[0]! : null;
    };
    // One bot is one agent's: Hermes reads a bot's token from its agent's .env, and an agent's
    // .env has one token variable per app.
    const agentChannels = (channelEdges.get(agent.id) ?? []).slice().sort((x, y) => (x.data.platform < y.data.platform ? -1 : x.data.platform > y.data.platform ? 1 : 0));
    for (const [platform] of duplicates(agentChannels, (c) => c.data.platform))
      issues.push({ level: "error", nodeId: agent.id, message: `Agent "${agent.data.name}" has two ${platform} bots; keep one` });
    const team = (handoffs.get(agent.id) ?? []).slice().sort((x, y) => (x.data.name < y.data.name ? -1 : x.data.name > y.data.name ? 1 : 0));
    bundles.push({ agent, models: chain, tools: agentTools, image: maker("image"), video: maker("video"), channels: agentChannels, team });
  }
  bundles.sort((x, y) => (x.agent.data.name < y.agent.data.name ? -1 : x.agent.data.name > y.agent.data.name ? 1 : 0));

  for (const [channelId, owners] of channelOwners)
    if (owners.length > 1) issues.push({ level: "error", nodeId: channelId, message: `A bot answers as one agent; it is wired to ${owners.length}` });

  for (const n of [...models, ...tools, ...makers, ...channels])
    if (!wired.has(n.id)) issues.push({ level: "warning", nodeId: n.id, message: `${label(n)} is not wired to any agent and will not be compiled` });
  if (agents.length === 0) issues.push({ level: "error", message: "Nothing to compile: add an agent node" });

  return { graph, bundles, issues };
}
