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

/**
 * What an agent can do: Hermes' tool sets, in the order the inspector shows them
 * (hermes_cli/tools_config.py CONFIGURABLE_TOOLSETS; platform-only ones left out).
 * McBot runs land on Hermes' `cli` surface, so a list compiles to
 * `platform_toolsets.cli` (docs/HERMES.md).
 */
export const CAPABILITIES = [
  { key: "web", label: "Web search" },
  { key: "browser", label: "Browser" },
  { key: "file", label: "Files" },
  { key: "terminal", label: "Terminal" },
  { key: "code_execution", label: "Code" },
  { key: "vision", label: "See images" },
  { key: "image_gen", label: "Make images" },
  { key: "video_gen", label: "Make videos" },
  { key: "tts", label: "Speak" },
  { key: "memory", label: "Memory" },
  { key: "session_search", label: "Past chats" },
  { key: "skills", label: "Skills" },
  { key: "todo", label: "Plans" },
  { key: "clarify", label: "Ask back" },
  { key: "delegation", label: "Helpers" },
  { key: "cronjob", label: "Schedules" },
  { key: "kanban", label: "Task board" },
  { key: "computer_use", label: "Use the computer" },
  { key: "connections", label: "Connections" },
] as const;
export type Capability = (typeof CAPABILITIES)[number]["key"];
export const CapabilitySchema = z.enum(CAPABILITIES.map((c) => c.key) as [Capability, ...Capability[]]);

/**
 * What Hermes gives the `cli` surface when platform_toolsets.cli is unset:
 * `_get_platform_tools({}, "cli")` in hermes/ at v0.23.1 (3b4215785882), checked again on
 * every engine sync. Video and the task board are opt-in (tools_config.py _DEFAULT_OFF_TOOLSETS).
 */
export const DEFAULT_CAPABILITIES: readonly Capability[] = [
  "web", "browser", "file", "terminal", "code_execution", "vision", "image_gen", "tts", "memory",
  "session_search", "skills", "todo", "clarify", "delegation", "cronjob", "computer_use", "connections",
];

export const AgentDataSchema = z.object({
  /** The Hermes profile id: runs as `hermes -p <name>`. */
  name: z.string().regex(PROFILE_NAME_RE, "lowercase profile id: a-z, 0-9, - or _ (max 64)"),
  displayName: z.string().default(""),
  description: z.string().default(""),
  /** SOUL.md — the agent's identity, slot #1 of its system prompt. */
  soul: z.string().default(""),
  skills: z.array(SkillSchema).default([]),
  /** Tool sets this agent may use; null = Hermes' default (DEFAULT_CAPABILITIES). */
  capabilities: z.array(CapabilitySchema).nullable().default(null),
  /**
   * Daily spend limit in USD (UTC day). McBot-side only: never compiled into Hermes, it drives the
   * budget bar in Cost and the alert in Home. null/unset = no limit.
   */
  dailyBudgetUsd: z.number().positive().max(1_000_000).nullish(),
  /** How its browser runs (Hermes' `browser:` settings); null = Hermes' defaults. */
  browser: z.object({
    /** A visible window you can watch (`browser.headed`). */
    show: z.boolean().default(false),
    /** "lightpanda": the fast engine, installed by the person (`browser.engine`). */
    engine: z.enum(["chromium", "lightpanda"]).default("chromium"),
    /** Browse with the person's own logins (`browser.use_real_profile`). */
    myLogins: z.boolean().default(false),
  }).nullish(),
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

/**
 * Image and video makers. These are Hermes' own provider plugins, not McBot
 * providers: the board only names one (`image_gen.provider` / `video_gen.provider`)
 * and the variable its key is read from. Ids are each plugin's registered name,
 * keys its `requires_env` (hermes/plugins/image_gen/*, hermes/plugins/video_gen/*).
 */
export const MEDIA_PROVIDERS = {
  image: {
    openai: { label: "OpenAI", keyEnv: "OPENAI_API_KEY" },
    openrouter: { label: "OpenRouter", keyEnv: "OPENROUTER_API_KEY" },
    fal: { label: "FAL", keyEnv: "FAL_KEY" },
    xai: { label: "xAI", keyEnv: "XAI_API_KEY" },
    krea: { label: "Krea", keyEnv: "KREA_API_KEY" },
    deepinfra: { label: "DeepInfra", keyEnv: "DEEPINFRA_API_KEY" },
    "meta-ai": { label: "Meta", keyEnv: "META_MODEL_API_KEY" },
  },
  video: {
    fal: { label: "FAL", keyEnv: "FAL_KEY" },
    openrouter: { label: "OpenRouter", keyEnv: "OPENROUTER_API_KEY" },
    xai: { label: "xAI", keyEnv: "XAI_API_KEY" },
    deepinfra: { label: "DeepInfra", keyEnv: "DEEPINFRA_API_KEY" },
  },
} as const satisfies Record<"image" | "video", Record<string, { label: string; keyEnv: string }>>;
export type MediaKind = keyof typeof MEDIA_PROVIDERS;

export const MediaDataSchema = z.object({
  name: slug,
  label: z.string().default(""),
  media: z.enum(["image", "video"]),
  /** A key of MEDIA_PROVIDERS[media]; checked in validate.ts. */
  provider: z.string().min(1),
  /** Optional; empty = the provider's default (`image_gen.model` / `video_gen.model`). */
  model: z.string().default(""),
});
export type MediaData = z.infer<typeof MediaDataSchema>;

/**
 * Chat apps an agent answers in, through Hermes' gateway: every platform plugin Hermes ships,
 * generated from its plugin.yaml (src/contracts/platforms.generated.ts). Each block is one bot that
 * belongs to one agent. Its secrets (tokens, passwords) are saved in McBot under names of their own
 * (`channelKeyName`) and its plain settings (ids, addresses) sit on the board; both, and who may
 * message it, go into that agent's `.env` under the variables Hermes reads.
 */
export { PLATFORMS, type Platform, type PlatformField, type PlatformId } from "./platforms.generated";
import { PLATFORMS, type PlatformId } from "./platforms.generated";
/** Kept for boards and code from before every platform was listed. */
export const CHANNEL_PLATFORMS = PLATFORMS;
export type ChannelPlatform = PlatformId;

export const ChannelDataSchema = z.object({
  name: slug,
  label: z.string().default(""),
  platform: z.enum(Object.keys(PLATFORMS) as [PlatformId, ...PlatformId[]]),
  /** Telegram boards from before: McBot's name for the saved bot token. Others use `channelKeyName`. */
  tokenEnv: z.union([z.literal(""), z.string().regex(ENV_NAME_RE, "env var name")]).default(""),
  /** Plain (non-secret) settings the platform requires, by Hermes' variable name. */
  settings: z.record(z.string().regex(ENV_NAME_RE), z.string().max(2000)).default({}),
  /** Who may talk to the bot, in the platform's own ids. Empty = nobody (Hermes refuses unknown senders). */
  allowedUsers: z.array(z.string().trim().min(1).max(200).regex(/^[^,\n]+$/, "one id, no commas")).default([]),
  /** Telegram only: an own Bot API server (`platforms.telegram.extra.base_url`); empty = api.telegram.org. */
  apiBase: z.union([z.literal(""), z.string().url().refine((u) => /^https?:\/\//.test(u), "http(s) URL")]).default(""),
});
/** The name a chat app's secret is saved under in McBot (never the value). */
export function channelKeyName(c: { name: string; platform: PlatformId; tokenEnv: string }, env: string): string {
  const first = PLATFORMS[c.platform].required.find((f) => f.secret)?.env;
  if (env === first && c.tokenEnv) return c.tokenEnv;
  return `MCBOT_${c.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_${env}`;
}
export type ChannelData = z.infer<typeof ChannelDataSchema>;

const nodeBase = { id: z.string().min(1), position: PositionSchema };

export const NodeSchema = z.discriminatedUnion("kind", [
  z.object({ ...nodeBase, kind: z.literal("agent"), data: AgentDataSchema }),
  z.object({ ...nodeBase, kind: z.literal("model"), data: ModelDataSchema }),
  z.object({ ...nodeBase, kind: z.literal("tool"), data: ToolDataSchema }),
  z.object({ ...nodeBase, kind: z.literal("media"), data: MediaDataSchema }),
  z.object({ ...nodeBase, kind: z.literal("channel"), data: ChannelDataSchema }),
]);
export type GraphNode = z.infer<typeof NodeSchema>;
export type NodeKind = GraphNode["kind"];
export type AgentNode = Extract<GraphNode, { kind: "agent" }>;
export type ModelNode = Extract<GraphNode, { kind: "model" }>;
export type ToolNode = Extract<GraphNode, { kind: "tool" }>;
export type MediaNode = Extract<GraphNode, { kind: "media" }>;
export type ChannelNode = Extract<GraphNode, { kind: "channel" }>;

export const EdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  /** Agent→model edges only: 0 = primary, higher = later in the fallback chain. */
  order: z.number().int().min(0).default(0),
});
export type GraphEdge = z.infer<typeof EdgeSchema>;

/** Sticky-note colours: names, so each theme picks its own shade (tokens.css `--note-*`). */
export const NOTE_COLORS = ["yellow", "green", "blue", "pink", "purple", "gray"] as const;

/**
 * A sticky note on the board: for the people, never compiled. Pinned notes also show on Home.
 * Added to mcbot.graph/v1 additively: a board without notes is unchanged, and the compiler
 * never reads them.
 */
export const NoteSchema = z.object({
  id: z.string().min(1),
  text: z.string().max(10_000).default(""),
  color: z.enum(NOTE_COLORS).default("yellow"),
  position: PositionSchema,
  pinned: z.boolean().default(false),
  /** Who wrote it, and when (Unix ms). */
  author: z.string().max(64).default(""),
  at: z.number().int().nonnegative().default(0),
});
export type Note = z.infer<typeof NoteSchema>;

/**
 * Team chat on a board: people and agents talking, live for everyone on it. Never compiled; added
 * to mcbot.graph/v1 additively, like notes. A message from an agent names it (`agent`).
 */
export const MessageSchema = z.object({
  id: z.string().min(1),
  author: z.string().max(64).default(""),
  /** The writer's colour (people) for their face; agents use their own food colour. */
  color: z.string().max(32).default(""),
  /** Set when an agent wrote it: its profile id. */
  agent: z.string().max(64).default(""),
  text: z.string().max(20_000).default(""),
  at: z.number().int().nonnegative().default(0),
});
export type Message = z.infer<typeof MessageSchema>;
/** A board keeps its last messages; older ones drop off. */
export const MESSAGES_KEPT = 500;

export const GraphSchema = z.object({
  schema: z.literal(GRAPH_SCHEMA),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  name: z.string().default(""),
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
  /** Sticky notes (optional, never compiled). */
  notes: z.array(NoteSchema).optional(),
  /** Team chat (optional, never compiled). */
  messages: z.array(MessageSchema).optional(),
});
export type Graph = z.infer<typeof GraphSchema>;

export function emptyGraph(id: string, name: string): Graph {
  return { schema: GRAPH_SCHEMA, id, name, nodes: [], edges: [] };
}
