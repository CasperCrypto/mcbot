/**
 * The setup assistant's answers → a board that can do the work: the brief every agent knows (who
 * you are, what you do, for whom, your goals and voice), the starter teams for what you want done,
 * each with its real tools and makers (a designer that makes images, a researcher that searches the
 * web), wired to the models picked. Pure: answers in, graph out (tested against the real compiler).
 */
import type { SetupKind, SetupProfile } from "../../contracts/api";
import { BRIEF_MAX, GRAPH_SCHEMA, MEDIA_PROVIDERS, emptyBrief, type Brief, type Graph, type GraphNode, type ModelNode } from "../../contracts/graph";
import { TEAMS, makerProvider, teamToAdd, type StarterTeam } from "../graph/teams";
import { boardName, type ModelChoice } from "./presets";

/** What people want their agents to do first, each answered by a starter team (graph/teams.ts). */
export const GOALS: { id: string; label: string; sub: string; team: string }[] = [
  { id: "social", label: "Social media", sub: "Posts with their images, a calendar", team: "social" },
  { id: "content", label: "Blog & newsletter", sub: "Articles, newsletters, images", team: "content" },
  { id: "sales", label: "Sales & outreach", sub: "Find leads, draft outreach", team: "sales" },
  { id: "support", label: "Customer support", sub: "Answer and route questions", team: "support" },
  { id: "research", label: "Research & reports", sub: "Sources, summaries, write-ups", team: "research" },
  { id: "launch", label: "Launch something", sub: "Page, posts and a video", team: "launch" },
  { id: "dev", label: "Software", sub: "Plan, code and review", team: "dev" },
  { id: "markets", label: "Markets & finance", sub: "Watch, model, brief", team: "markets" },
  { id: "knowledge", label: "A knowledge base", sub: "A wiki that stays up to date", team: "knowledge" },
  { id: "personal", label: "Everyday help", sub: "Plan days, draft mail, look things up", team: "personal" },
];

export const defaultGoals = (kind: SetupKind): string[] => (kind === "personal" ? ["personal"] : kind === "team" ? ["research"] : ["social", "sales"]);

/** Voices to start from (the field stays free text). */
export const VOICES = ["Friendly", "Professional", "Bold", "Playful", "Calm", "Expert", "Short and direct"] as const;
/** Channels to start from. */
export const CHANNELS = ["Instagram", "LinkedIn", "TikTok", "X", "Facebook", "YouTube", "Newsletter", "Blog", "Website"] as const;

/** Add or take away one item of a comma-separated list ("Instagram, LinkedIn"). */
export function toggleListed(list: string, item: string): string {
  const items = list.split(",").map((x) => x.trim()).filter(Boolean);
  const has = items.some((x) => x.toLowerCase() === item.toLowerCase());
  return (has ? items.filter((x) => x.toLowerCase() !== item.toLowerCase()) : [...items, item]).join(", ");
}
export const listed = (list: string, item: string) => list.split(",").some((x) => x.trim().toLowerCase() === item.toLowerCase());

/** The extra answers the setup asks for, beyond who you are. */
export interface SetupAnswers {
  offer: string;
  customers: string;
  goals: string;
  voice: string;
  channels: string;
  links: string;
}
export const emptyAnswers = (): SetupAnswers => ({ offer: "", customers: "", goals: "", voice: "", channels: "", links: "" });

/** Who you are and what you said → the brief every agent gets. */
export function briefFromSetup(p: SetupProfile, a: SetupAnswers): Brief {
  const b = emptyBrief();
  const who = p.kind === "personal"
    ? p.name.trim()
    : [p.company.trim(), p.name.trim() ? `${p.name.trim()}${p.role.trim() ? `, ${p.role.trim()}` : ""} leads the agents` : ""].filter(Boolean).join(". ");
  const set = (k: keyof Brief, v: string) => { b[k] = v.trim().slice(0, BRIEF_MAX[k]); };
  set("who", who);
  set("what", p.about);
  set("offer", a.offer);
  set("customers", a.customers);
  set("goals", a.goals);
  set("voice", a.voice);
  set("channels", a.channels);
  set("links", a.links);
  return b;
}

/** The teams for these goals, in the order the goals are listed, each once. */
export function teamsFor(goals: readonly string[]): StarterTeam[] {
  const ids = [...new Set(GOALS.filter((g) => goals.includes(g.id)).map((g) => g.team))];
  return ids.map((id) => TEAMS.find((t) => t.id === id)).filter((t): t is StarterTeam => !!t);
}

/** A member's key in the skip list: "<team>/<member>". */
export const memberKey = (team: StarterTeam, member: string) => `${team.id}/${member}`;

/** A team without the members left out (and their hand-offs); null when nobody is left. */
export function withoutSkipped(team: StarterTeam, skip: ReadonlySet<string>): StarterTeam | null {
  const members = team.members.filter((m) => !skip.has(memberKey(team, m.name)));
  if (!members.length) return null;
  const kept = new Set(members.map((m) => m.name));
  return { ...team, members, handoffs: team.handoffs.filter(([f, t]) => kept.has(f) && kept.has(t)) };
}

/** What the chosen teams need from the person: an image or video maker's key, web search. */
export function setupNeeds(teams: readonly StarterTeam[]): { image: boolean; video: boolean; web: boolean } {
  const members = teams.flatMap((t) => t.members);
  return {
    image: members.some((m) => m.makers?.includes("image")),
    video: members.some((m) => m.makers?.includes("video")),
    web: members.some((m) => m.tools?.includes("exa")),
  };
}

/** The setup's free image and video choice: Hugging Face's own connector (hermes/optional-mcps/hugging_face). */
export const HUGGING_FACE = "huggingface";
export const HF_TOOL = "connector-hugging_face";

let seq = 0;
const nid = (p: string) => `${p}-${(++seq).toString(36)}`;

/**
 * The board: models on the left (the first is primary, the next its fallback), then each team
 * below the last (lead on top, members under it, their tools and makers beside them), the shared
 * files tool for everyone, and the brief. `maker` is the image/video service picked (else the one
 * the cloud model's key also runs). Returns the skills to install after the first compile.
 */
export function buildSetupBoard(opts: {
  profile: SetupProfile;
  brief: Brief;
  teams: readonly StarterTeam[];
  skip?: ReadonlySet<string>;
  models: readonly ModelChoice[];
  workspace: string;
  /** The image/video service: one of Hermes' maker services, or "huggingface" (its connector instead of a maker). */
  maker?: string | null;
}): { graph: Graph; lead: string | null; skills: { profile: string; who: string; ids: readonly string[] }[] } {
  const graph: Graph = { schema: GRAPH_SCHEMA, id: "setup", name: boardName(opts.profile), nodes: [], edges: [] };
  const models: ModelNode[] = opts.models.map((m, i) => ({
    id: `model-${m.endpoint}`, kind: "model", position: { x: -420, y: i * 200 },
    data: { name: m.endpoint, label: m.label, endpoint: m.endpoint, baseUrl: m.baseUrl, model: m.model, apiKeyEnv: m.endpoint === "cloud" ? m.apiKeyEnv : "", pricing: null },
  }));
  graph.nodes.push(...models);
  const skills: { profile: string; who: string; ids: readonly string[] }[] = [];
  let lead: string | null = null;
  // With no model yet the agents still go on the board; a local model block waits to be set.
  const newModel = (position: { x: number; y: number }): GraphNode => ({
    id: nid("model"), kind: "model", position,
    data: { name: "local", label: "Local model", endpoint: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "", apiKeyEnv: "", pricing: null },
  });
  // Hugging Face makes pictures and video through its Spaces: members that would get a maker get its connector.
  const viaHf = opts.maker === HUGGING_FACE;
  for (const t0 of opts.teams) {
    const t = viaHf ? { ...t0, members: t0.members.map((m) => (m.makers?.length ? { ...m, makers: [], tools: [...(m.tools ?? []), HF_TOOL] } : m)) } : t0;
    const team = withoutSkipped(t, opts.skip ?? new Set());
    if (!team) continue;
    const primary = graph.nodes.find((n): n is ModelNode => n.kind === "model") ?? null;
    const add = teamToAdd(graph, team, primary, newModel);
    graph.nodes.push(...add.nodes);
    graph.edges.push(...add.edges);
    lead ??= add.lead;
    skills.push(...add.skills);
  }
  const agents = graph.nodes.filter((n) => n.kind === "agent");
  // The second model takes over when the first can't answer.
  const fallback = models[1];
  if (fallback) for (const a of agents) graph.edges.push({ id: nid("edge"), source: fallback.id, target: a.id, order: 1 });
  // Makers on the service picked (one key for everything when it is the cloud model's).
  for (const n of graph.nodes) {
    if (n.kind !== "media") continue;
    const service = opts.maker && Object.hasOwn(MEDIA_PROVIDERS[n.data.media], opts.maker) ? opts.maker : makerProvider(graph, n.data.media);
    n.data = { ...n.data, provider: service };
  }
  // One shared files folder, so what one agent makes (a post, an image list) the others can read.
  if (agents.length) {
    const right = Math.max(...graph.nodes.map((n) => n.position.x)) + 320;
    graph.nodes.push({
      id: "tool-files", kind: "tool", position: { x: right, y: 0 },
      data: { name: "files", label: "Shared files", transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", `${opts.workspace.replace(/[\\/]+$/, "")}/files`], env: {}, url: "", headers: {} },
    });
    for (const a of agents) graph.edges.push({ id: nid("edge"), source: a.id, target: "tool-files", order: 0 });
  }
  if (Object.values(opts.brief).some((v) => v.trim())) graph.brief = opts.brief;
  return { graph, lead, skills };
}
