import {
  GraphSchema,
  RESERVED_PROFILE_NAMES,
  type AgentNode,
  type Graph,
  type GraphNode,
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
}

export interface Resolved {
  graph: Graph;
  bundles: AgentBundle[];
  issues: Issue[];
}

const PAIRS = new Set(["agent:model", "model:agent", "agent:tool", "tool:agent"]);

function label(n: GraphNode): string {
  return n.data.name ? `${n.kind} "${n.data.name}"` : `${n.kind} ${n.id}`;
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
  if (!parsed.success) {
    const issues = parsed.error.issues.map<Issue>((i) => ({
      level: "error",
      message: `${i.path.join(".") || "graph"}: ${i.message}`,
    }));
    return { graph: input as Graph, bundles: [], issues };
  }
  const graph = parsed.data;
  const issues: Issue[] = [];
  const byId = new Map<string, GraphNode>();

  for (const [id] of duplicates(graph.nodes, (n) => n.id)) issues.push({ level: "error", nodeId: id, message: `Duplicate node id ${id}` });
  for (const [id] of duplicates(graph.edges, (e) => e.id)) issues.push({ level: "error", edgeId: id, message: `Duplicate edge id ${id}` });
  for (const n of graph.nodes) byId.set(n.id, n);

  const agents = graph.nodes.filter((n): n is AgentNode => n.kind === "agent");
  const models = graph.nodes.filter((n): n is ModelNode => n.kind === "model");
  const tools = graph.nodes.filter((n): n is ToolNode => n.kind === "tool");

  for (const [name, ns] of duplicates(agents, (n) => n.data.name))
    for (const n of ns) issues.push({ level: "error", nodeId: n.id, message: `Two agents are named "${name}"; agent names are Hermes profile ids and must be unique` });
  for (const [name, ns] of duplicates(models, (n) => n.data.name))
    for (const n of ns) issues.push({ level: "error", nodeId: n.id, message: `Two models are named "${name}"` });
  for (const [name, ns] of duplicates(tools, (n) => n.data.name))
    for (const n of ns) issues.push({ level: "error", nodeId: n.id, message: `Two tools are named "${name}"` });

  for (const a of agents) {
    if (RESERVED_PROFILE_NAMES.includes(a.data.name))
      issues.push({ level: "error", nodeId: a.id, message: `"${a.data.name}" is reserved by Hermes and cannot be a profile name` });
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

  const modelEdges = new Map<string, { edgeId: string; order: number; model: ModelNode }[]>();
  const toolEdges = new Map<string, ToolNode[]>();
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
      issues.push({ level: "error", edgeId: e.id, message: `Cannot connect ${label(s)} to ${label(t)}; wire models and tools to agents` });
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
    bundles.push({ agent, models: chain, tools: agentTools });
  }
  bundles.sort((x, y) => (x.agent.data.name < y.agent.data.name ? -1 : x.agent.data.name > y.agent.data.name ? 1 : 0));

  for (const n of [...models, ...tools])
    if (!wired.has(n.id)) issues.push({ level: "warning", nodeId: n.id, message: `${label(n)} is not wired to any agent and will not be compiled` });
  if (agents.length === 0) issues.push({ level: "error", message: "Nothing to compile: add an agent node" });

  return { graph, bundles, issues };
}
