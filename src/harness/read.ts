/**
 * Hermes setup → board: the inverse of compile (docs/PLAN.md, decision 5: Hermes' files are the
 * harness, the board is its live picture and editor).
 *
 * Pure: it gets each profile's files as text (the engine reads them) and returns a board plus a
 * list of what it could not show yet. It reads only keys McBot already compiles, each verified in
 * docs/HERMES.md; anything else stays in Hermes' files and is listed in `unshown`. Compiling the
 * board it returns gives back the same config.yaml, SOUL.md, profile.yaml and SKILL.md bytes
 * (src/harness/read.test.ts), apart from compile's header comment.
 */
import { parse } from "yaml";
import {
  CAPABILITIES,
  GRAPH_SCHEMA,
  MEDIA_PROVIDERS,
  PROFILE_NAME_RE,
  SLUG_RE,
  SkillSchema,
  type AgentData,
  type Capability,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type ModelData,
  type Note,
  type Skill,
  type ToolData,
} from "../contracts/graph";

/** One Hermes profile as files: `profiles/<name>/…`, or the root itself for `default`. */
export interface ProfileFiles {
  name: string;
  /** config.yaml */
  config: string | null;
  /** SOUL.md */
  soul: string | null;
  /** profile.yaml */
  profileYaml: string | null;
  /** skills/<dir>/SKILL.md, by <dir> (top level only: Hermes' seeded skills sit in category dirs). */
  skills: Readonly<Record<string, string>>;
}

export interface Unshown {
  profile: string;
  /** The config key or file, e.g. `config.yaml: memory`, `skills/research`. */
  what: string;
  why: string;
}

export interface ReadResult {
  graph: Graph;
  unshown: Unshown[];
}

/** Keys of config.yaml the board shows (src/compile/config.ts writes exactly these). */
const SHOWN_KEYS = new Set(["model", "providers", "fallback_providers", "mcp_servers", "platform_toolsets", "browser", "image_gen", "video_gen", "platforms"]);
const CAP_KEYS = new Set<string>(CAPABILITIES.map((c) => c.key));
const TEAM_HEAD = "## Team";
const TEAM_LINE = /^- `([a-z0-9][a-z0-9_-]{0,63})`/;
/** The sentence compile writes under "## Team" (src/compile/soul.ts). */
const TEAM_INTRO = "You can hand work to these agents.";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const strMap = (v: unknown): Record<string, string> =>
  isObj(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === "string" || typeof x === "number").map(([k, x]) => [k, String(x)])) : {};
const yaml11 = (text: string): unknown => parse(text, { version: "1.1" });

/** "custom:mcbot-local" → "local"; another provider id → null (not a McBot model, rule 4). */
function mcbotProvider(ref: string): string | null {
  const m = /^custom:mcbot-([a-z0-9][a-z0-9_-]{0,63})$/.exec(ref);
  return m ? m[1]! : null;
}

function isLocal(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]" || h.endsWith(".local");
  } catch {
    return false;
  }
}

/** Split SOUL.md into the agent's own text and the hand-off list compile appends (src/compile/soul.ts). */
export function splitSoul(soul: string): { own: string; team: string[] } {
  const at = soul.indexOf(`\n\n${TEAM_HEAD}\n\n`);
  if (at < 0) return { own: soul, team: [] };
  const tail = soul.slice(at + TEAM_HEAD.length + 4).split("\n");
  const team = tail.map((l) => TEAM_LINE.exec(l)?.[1]).filter((n): n is string => !!n);
  // Anything a person wrote after the list is theirs, not the section's: it stays (compile puts it
  // back above the Team section, which it always writes last).
  const after = tail.filter((l) => l.trim() && !TEAM_LINE.test(l) && !l.startsWith(TEAM_INTRO)).join("\n").trim();
  const own = soul.slice(0, at);
  return { own: after ? `${own}\n\n${after}` : own, team };
}

/** SKILL.md → a board skill, or null when it is not one the board can hold. */
export function readSkill(text: string): Skill | null {
  const m = /^---\n([\s\S]*?)\n?---\n\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"));
  if (!m) return null;
  let fm: unknown;
  try {
    fm = yaml11(`${m[1]}\n`);
  } catch {
    return null;
  }
  if (!isObj(fm)) return null;
  const hermes = isObj(fm.metadata) && isObj(fm.metadata.hermes) ? fm.metadata.hermes : {};
  const parsed = SkillSchema.safeParse({
    name: fm.name,
    description: fm.description,
    version: fm.version === undefined ? undefined : String(fm.version),
    author: str(fm.author),
    license: str(fm.license),
    platforms: strs(fm.platforms),
    tags: strs(hermes.tags),
    body: m[2]!.replace(/\n+$/, ""),
  });
  return parsed.success ? parsed.data : null;
}

/** A tidy first layout: agents in a column, their models to the left, everything else to the right. */
const AGENT_X = 0;
const MODEL_X = -360;
const SIDE_X = 360;
const ROW = 220;

export function readHermes(board: { id: string; name: string }, profiles: readonly ProfileFiles[]): ReadResult {
  const unshown: Unshown[] = [];
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const byKey = new Map<string, string>(); // shared node identity → node id
  let sideY = 0;

  const shared = (key: string, make: () => GraphNode): string => {
    const have = byKey.get(key);
    if (have) return have;
    const node = make();
    byKey.set(key, node.id);
    nodes.push(node);
    return node.id;
  };
  const edge = (source: string, target: string, order = 0) => {
    const id = `e-${source.slice(2)}-${target.slice(2)}`;
    if (!edges.some((e) => e.id === id)) edges.push({ id, source, target, order });
  };

  const sorted = [...profiles].filter((p) => PROFILE_NAME_RE.test(p.name)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const p of profiles) if (!PROFILE_NAME_RE.test(p.name)) unshown.push({ profile: p.name, what: "profile", why: "not a profile name Hermes accepts" });
  const teams = new Map<string, string[]>();

  sorted.forEach((p, row) => {
    const agentId = `n-agent-${p.name}`;
    const y = row * ROW * 2;
    let cfg: Obj = {};
    if (p.config !== null) {
      try {
        const doc = yaml11(p.config);
        if (isObj(doc)) cfg = doc;
      } catch (err) {
        unshown.push({ profile: p.name, what: "config.yaml", why: `not valid YAML (${(err as Error).message.split("\n")[0]})` });
      }
    }
    for (const k of Object.keys(cfg).sort()) {
      if (!SHOWN_KEYS.has(k)) unshown.push({ profile: p.name, what: `config.yaml: ${k}`, why: "kept in Hermes; not on the board yet" });
    }

    // Who the agent is: SOUL.md (without the compiled Team section) and profile.yaml.
    const { own, team } = splitSoul((p.soul ?? "").replace(/\n+$/, ""));
    if (team.length) teams.set(p.name, team);
    let meta: Obj = {};
    if (p.profileYaml) {
      try {
        const doc = yaml11(p.profileYaml);
        if (isObj(doc)) meta = doc;
      } catch {
        unshown.push({ profile: p.name, what: "profile.yaml", why: "not valid YAML" });
      }
    }

    // Skills the board can hold; the rest stay installed in Hermes.
    const skills: Skill[] = [];
    for (const dir of Object.keys(p.skills).sort()) {
      const s = readSkill(p.skills[dir]!);
      if (s && s.name === dir) skills.push(s);
      else unshown.push({ profile: p.name, what: `skills/${dir}`, why: "installed in Hermes; not a skill the board can edit yet" });
    }

    // Models: the primary and its fallbacks, when they are McBot's two kinds of endpoint.
    const providers = isObj(cfg.providers) ? cfg.providers : {};
    const model = isObj(cfg.model) ? cfg.model : {};
    const chain: { ref: string; model: string }[] = [];
    if (str(model.provider)) chain.push({ ref: str(model.provider), model: str(model.default) });
    if (Array.isArray(cfg.fallback_providers)) {
      for (const f of cfg.fallback_providers) if (isObj(f)) chain.push({ ref: str(f.provider), model: str(f.model) });
    }
    chain.forEach((c, order) => {
      const name = mcbotProvider(c.ref);
      const entry = name ? providers[`mcbot-${name}`] : undefined;
      if (!name || !isObj(entry) || !str(entry.api)) {
        unshown.push({ profile: p.name, what: `model ${c.ref || "(none)"}`, why: "a Hermes provider the board cannot show yet (only local and cloud OpenAI-compatible endpoints)" });
        return;
      }
      const data: ModelData = {
        name,
        label: "",
        endpoint: isLocal(str(entry.api)) ? "local" : "cloud",
        baseUrl: str(entry.api),
        model: c.model || str(entry.default_model),
        apiKeyEnv: str(entry.key_env),
        pricing: null,
      };
      const key = `model ${name} ${data.baseUrl} ${data.model} ${data.apiKeyEnv}`;
      const id = shared(key, () => ({ id: `n-model-${name}${byKeyCount("model", name)}`, kind: "model", position: { x: MODEL_X, y: y + order * 140 }, data }));
      edge(agentId, id, order);
    });

    // Tools: MCP servers.
    const servers = isObj(cfg.mcp_servers) ? cfg.mcp_servers : {};
    for (const name of Object.keys(servers).sort()) {
      const s = servers[name];
      if (!SLUG_RE.test(name) || !isObj(s)) {
        unshown.push({ profile: p.name, what: `mcp_servers.${name}`, why: "a server name the board cannot hold" });
        continue;
      }
      const oauth = str(s.auth).toLowerCase() === "oauth";
      const data: ToolData = s.url
        ? { name, label: "", transport: "http", command: "", args: [], env: {}, url: str(s.url), headers: strMap(s.headers),
          ...(oauth ? { auth: "oauth" as const } : {}), ...(oauth && isObj(s.oauth) ? { oauth: Object.fromEntries(Object.entries(s.oauth).filter((e): e is [string, string | number] => typeof e[1] === "string" || typeof e[1] === "number")) } : {}) }
        : { name, label: "", transport: "stdio", command: str(s.command), args: strs(s.args), env: strMap(s.env), url: "", headers: {} };
      const id = shared(`tool ${JSON.stringify(data)}`, () => ({ id: `n-tool-${name}${byKeyCount("tool", name)}`, kind: "tool", position: { x: SIDE_X, y: sideY++ * 120 }, data }));
      edge(agentId, id);
    }

    // Image and video makers.
    for (const media of ["image", "video"] as const) {
      const m = cfg[`${media}_gen`];
      if (!isObj(m)) continue;
      const provider = str(m.provider);
      if (!(provider in MEDIA_PROVIDERS[media])) {
        unshown.push({ profile: p.name, what: `config.yaml: ${media}_gen`, why: `the ${provider || "unnamed"} maker is not on the board yet` });
        continue;
      }
      const name = `${media}-${provider}`.replace(/[^a-z0-9_-]/g, "-");
      const data = { name, label: "", media, provider, model: str(m.model) };
      const id = shared(`media ${JSON.stringify(data)}`, () => ({ id: `n-${name}${byKeyCount("media", name)}`, kind: "media", position: { x: SIDE_X, y: sideY++ * 120 }, data }));
      edge(agentId, id);
    }

    // A Telegram bot with its own Bot API server (the token lives in .env; the engine adds it).
    const platforms = isObj(cfg.platforms) ? cfg.platforms : {};
    for (const platform of Object.keys(platforms).sort()) {
      const extra = isObj(platforms[platform]) && isObj((platforms[platform] as Obj).extra) ? ((platforms[platform] as Obj).extra as Obj) : {};
      if (platform !== "telegram" || !str(extra.base_url)) {
        unshown.push({ profile: p.name, what: `platforms.${platform}`, why: "this chat app is not on the board yet" });
        continue;
      }
      const name = `${p.name}-telegram`.slice(0, 64);
      const id = `n-${name}`;
      nodes.push({ id, kind: "channel", position: { x: SIDE_X, y: sideY++ * 120 }, data: { name, label: "", platform: "telegram", tokenEnv: "", settings: {}, allowedUsers: [], apiBase: str(extra.base_url) } });
      edge(agentId, id);
    }

    // Abilities: platform_toolsets.cli, without what compile adds by itself (makers, hand-offs).
    let capabilities: Capability[] | null = null;
    const ts = isObj(cfg.platform_toolsets) ? cfg.platform_toolsets : {};
    if (Array.isArray(ts.cli)) {
      const list = strs(ts.cli);
      for (const t of list) if (!CAP_KEYS.has(t)) unshown.push({ profile: p.name, what: `platform_toolsets.cli: ${t}`, why: "an ability the board does not list yet" });
      // Off-by-default sets compile turns on by itself for a wired video maker or a hand-off.
      const auto = new Set<string>();
      if (isObj(cfg.video_gen)) auto.add("video_gen");
      if (team.length) auto.add("kanban");
      capabilities = list.filter((t): t is Capability => CAP_KEYS.has(t) && !auto.has(t));
    }
    for (const surface of Object.keys(ts)) {
      if (surface !== "cli" && surface !== "api_server") unshown.push({ profile: p.name, what: `platform_toolsets.${surface}`, why: "abilities for another surface are kept in Hermes" });
    }

    const b = isObj(cfg.browser) ? cfg.browser : null;
    const browser = b
      ? { show: b.headed === true, engine: (b.engine === "lightpanda" ? "lightpanda" : "chromium") as "chromium" | "lightpanda", myLogins: b.use_real_profile === true }
      : null;

    const data: AgentData = {
      name: p.name,
      displayName: str(meta.display_name),
      description: str(meta.description),
      soul: own,
      skills,
      capabilities,
      browser,
    };
    nodes.push({ id: agentId, kind: "agent", position: { x: AGENT_X, y }, data });
  });

  // Hand-offs: the Team section of each SOUL.md, to agents that exist here.
  for (const [from, to] of teams) {
    for (const name of to) {
      if (sorted.some((p) => p.name === name)) edge(`n-agent-${from}`, `n-agent-${name}`);
      else unshown.push({ profile: from, what: `team: ${name}`, why: "hands work to an agent that is not in this setup" });
    }
  }

  return { graph: { schema: GRAPH_SCHEMA, id: board.id, name: board.name, nodes, edges }, unshown };

  // Distinct nodes that share a name (two different "local" models) get a numbered id.
  function byKeyCount(kind: string, name: string): string {
    const n = nodes.filter((x) => x.kind === kind && x.data.name === name).length;
    return n ? `-${n + 1}` : "";
  }
}

/** What a read could not show yet, as a sticky note on the new board (so nothing is hidden). */
export function unshownNote(unshown: readonly Unshown[], at = 0): Note | null {
  if (!unshown.length) return null;
  const lines = unshown.map((u) => `• ${u.profile}: ${u.what}: ${u.why}`);
  return { id: "note-unshown", text: `Kept in Hermes, not on the board yet\n\n${lines.join("\n")}`.slice(0, 10_000), color: "gray", position: { x: -360, y: -320 }, pinned: false, author: "McBot", at };
}
