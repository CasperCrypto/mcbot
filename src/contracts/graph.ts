/**
 * Contract 1 of 3 — the graph schema (docs/BUILD.md §2.2.1).
 *
 * The board everyone draws on. It is the only input to the compiler, so every
 * field here either maps to a verified Hermes file/key (docs/HERMES.md) or is
 * explicitly McBot-only (layout, labels, pricing).
 */
import { z } from "zod";

export const GRAPH_SCHEMA = "mcbot.graph/v1";

/** hermes_constants.PROFILE_ID_RE — the on-disk profile id grammar. */
export const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * Names Hermes refuses as profile ids: hermes_cli/profiles.py `_RESERVED_NAMES`
 * and `_HERMES_SUBCOMMANDS`.
 */
export const RESERVED_PROFILE_NAMES: readonly string[] = [
  "hermes", "default", "test", "tmp", "root", "sudo",
  "chat", "model", "gateway", "setup", "whatsapp", "login", "logout",
  "status", "cron", "doctor", "dump", "config", "pairing", "skills", "tools",
  "mcp", "connectors", "sessions", "insights", "version", "update", "uninstall",
  "profile", "plugins", "honcho", "acp",
];

/** Lowercase slug used for skill dirs, provider keys and MCP server keys. */
export const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** An environment variable NAME. McBot never stores secret values. */
export const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const slug = z.string().regex(SLUG_RE, "lowercase letters, digits, - or _; starts with a letter or digit");

export const PositionSchema = z.object({ x: z.number(), y: z.number() });

export const SkillSchema = z.object({
  name: slug,
  /** Hermes authoring standard: ≤ 60 chars, one sentence (skills/AGENTS.md). */
  description: z.string().min(1).max(60),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "semver x.y.z").default("1.0.0"),
  author: z.string().default(""),
  license: z.string().default(""),
  platforms: z.array(z.enum(["linux", "macos", "windows"])).default([]),
  tags: z.array(z.string().min(1)).default([]),
  /** Markdown body after the frontmatter. */
  body: z.string().default(""),
});
export type Skill = z.infer<typeof SkillSchema>;

export const AgentDataSchema = z.object({
  /** The Hermes profile id: runs as `hermes -p <name>`. */
  name: z.string().regex(PROFILE_NAME_RE, "lowercase profile id: a-z, 0-9, - or _ (max 64)"),
  displayName: z.string().default(""),
  description: z.string().default(""),
  /** SOUL.md — the agent's identity, slot #1 of its system prompt. */
  soul: z.string().default(""),
  skills: z.array(SkillSchema).default([]),
});
export type AgentData = z.infer<typeof AgentDataSchema>;

export const ModelDataSchema = z.object({
  /** Becomes the `providers:` key `mcbot-<name>` in config.yaml. */
  name: slug,
  label: z.string().default(""),
  /** Hard rule 4: exactly two kinds of endpoint, both OpenAI-compatible. */
  endpoint: z.enum(["local", "cloud"]),
  baseUrl: z.string().url().refine((u) => /^https?:\/\//.test(u), "http(s) URL"),
  model: z.string().min(1),
  /** Name of the env var holding the key (required for cloud). Never the value. */
  apiKeyEnv: z.union([z.literal(""), z.string().regex(ENV_NAME_RE, "env var name")]).default(""),
  /** McBot-only: USD per 1M tokens, used when Hermes reports no cost. */
  pricing: z
    .object({ inputPerMTok: z.number().min(0), outputPerMTok: z.number().min(0) })
    .nullable()
    .default(null),
});
export type ModelData = z.infer<typeof ModelDataSchema>;

export const ToolDataSchema = z.object({
  /** The `mcp_servers:` key. Hermes registers tools as mcp_<name>_<tool>. */
  name: slug,
  label: z.string().default(""),
  transport: z.enum(["stdio", "http"]),
  command: z.string().default(""),
  args: z.array(z.string()).default([]),
  env: z.record(z.string().regex(ENV_NAME_RE), z.string()).default({}),
  url: z.string().default(""),
  headers: z.record(z.string().min(1), z.string()).default({}),
});
export type ToolData = z.infer<typeof ToolDataSchema>;

const nodeBase = { id: z.string().min(1), position: PositionSchema };

export const NodeSchema = z.discriminatedUnion("kind", [
  z.object({ ...nodeBase, kind: z.literal("agent"), data: AgentDataSchema }),
  z.object({ ...nodeBase, kind: z.literal("model"), data: ModelDataSchema }),
  z.object({ ...nodeBase, kind: z.literal("tool"), data: ToolDataSchema }),
]);
export type GraphNode = z.infer<typeof NodeSchema>;
export type NodeKind = GraphNode["kind"];
export type AgentNode = Extract<GraphNode, { kind: "agent" }>;
export type ModelNode = Extract<GraphNode, { kind: "model" }>;
export type ToolNode = Extract<GraphNode, { kind: "tool" }>;

export const EdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  /** Agent→model edges only: 0 = primary, higher = later in the fallback chain. */
  order: z.number().int().min(0).default(0),
});
export type GraphEdge = z.infer<typeof EdgeSchema>;

export const GraphSchema = z.object({
  schema: z.literal(GRAPH_SCHEMA),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  name: z.string().default(""),
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
});
export type Graph = z.infer<typeof GraphSchema>;

export function emptyGraph(id: string, name: string): Graph {
  return { schema: GRAPH_SCHEMA, id, name, nodes: [], edges: [] };
}
