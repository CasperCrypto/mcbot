/**
 * Ask McBot, in the app: the choices a plan may use, a quick plan made here from the words alone
 * (when the board has no model to ask, in the demo, or when the model fails), and the blocks a plan
 * becomes on the board. Pure, tested against the real compiler (builder.test.ts).
 */
import type { Graph, GraphEdge, GraphNode, ModelNode } from "../../contracts/graph";
import { RESERVED_PROFILE_NAMES } from "../../contracts/graph";
import { LIBRARY } from "../../contracts/library.generated";
import { PLATFORMS, type PlatformId } from "../../contracts/platforms.generated";
import { restrictPlan, type HarnessPlan, type PlanAgent, type PlanChoices } from "../../harness/plan";
import { withRichAnswers } from "../chat/rich";
import { AGENT_SUGGESTIONS, agentIdFor } from "../shell/agentSuggestions";
import { CATALOG, CONNECTOR_TOOLS, catalogNode } from "./catalog";
import { newChannel } from "./defaults";
import { makerProvider } from "./teams";

const TOOLS = [...CATALOG, ...CONNECTOR_TOOLS];

export const PLAN_CHOICES: PlanChoices = {
  tools: TOOLS.map((t) => ({ id: t.id, does: t.does })),
  chatApps: Object.keys(PLATFORMS),
  skills: LIBRARY.map((s) => ({ id: s.id, does: s.description })),
};

const card = (name: string, rename?: string, makers: PlanAgent["makers"] = []): PlanAgent => {
  const s = AGENT_SUGGESTIONS.find((x) => x.name === name)!;
  return { name: rename ?? s.name, about: s.about, soul: s.soul, skills: [...(s.skills ?? [])], tools: [], chatApps: [], makers };
};
const own = (name: string, about: string, soul: string, skills: string[] = []): PlanAgent => ({ name, about, soul, skills, tools: [], chatApps: [], makers: [] });

/** Words → roles, most specific first. Each role is a starting card or a small agent of its own. */
const ROLES: { match: RegExp; agent: () => PlanAgent; tools?: string[] }[] = [
  { match: /support|customer|ticket|help ?desk|faq/i, agent: () => own("Support", "Answers customers from your docs.", "Answer customers warmly, briefly and exactly.\nAnswer from the docs; say when you don't know and hand it to a person.", ["official/research/qmd"]) },
  { match: /sales|lead gen|prospect|crm|outreach/i, agent: () => own("Sales Assistant", "Researches leads and drafts outreach.", "Research each lead before writing.\nShort, personal outreach; never send without an OK.", ["official/communication/one-three-one-rule"]), tools: ["exa"] },
  { match: /hir(e|ing)|recruit|candidate|interview/i, agent: () => own("Recruiter", "Screens candidates and schedules interviews.", "Compare candidates against the role's must-haves.\nBe fair and specific; never decide for a person.") },
  { match: /code|review|pull request|\bprs?\b|github|bug|developer|engineering/i, agent: () => card("Code Reviewer"), tools: ["context7"] },
  { match: /website|landing|web ?page|\bsite\b/i, agent: () => card("Web Builder") },
  { match: /video|youtube|reel|tiktok/i, agent: () => card("Video Maker", undefined, ["video"]) },
  { match: /social|\bposts?\b|instagram|linkedin|twitter|\bx\b|campaign|marketing/i, agent: () => card("Social Media Manager") },
  // Posts need pictures: a social or marketing request gets a designer that makes them.
  { match: /design|image|picture|visual|graphic|illustrat|mockup|diagram|logo|thumbnail|banner|social|\bposts?\b|instagram|campaign|marketing/i, agent: () => card("Designer", undefined, ["image"]) },
  { match: /\bnews\b|\bfeeds?\b|monitor|\bwatch|\brss\b/i, agent: () => card("News Watcher") },
  { match: /research|sources|competitor|analy[sz]e|investigate/i, agent: () => card("Researcher"), tools: ["exa"] },
  { match: /write|writing|blog|newsletter|copy|article|content/i, agent: () => card("Writing Partner", "Writer") },
  { match: /wiki|knowledge|docs|documentation|notes/i, agent: () => card("Knowledge Keeper") },
  { match: /e-?mail|inbox/i, agent: () => card("Inbox Helper") },
  { match: /calendar|meeting|organi[sz]|errand|to-?do|plan my/i, agent: () => card("Personal Organizer") },
  { match: /stock|trading|crypto|invest|portfolio/i, agent: () => card("Market Analyst") },
  { match: /financ|spreadsheet|excel|forecast|valuation|accounting/i, agent: () => card("Finance Modeler") },
  { match: /travel|trip|holiday|vacation/i, agent: () => card("Trip Planner") },
  { match: /fitness|workout|gym|diet|nutrition/i, agent: () => card("Fitness Coach") },
  { match: /learn|study|teach|course|tutor/i, agent: () => card("Learning Coach") },
  { match: /\bshop|\bbuy\b|compare products|\bprices?\b/i, agent: () => card("Shopping Scout") },
];

/** Tools named in the request (beyond what each role brings). */
const TOOL_WORDS: [RegExp, string][] = [
  [/notion/i, "notion"], [/linear/i, "connector-linear"], [/figma/i, "connector-figma"], [/stripe/i, "connector-stripe"],
  [/sentry/i, "connector-sentry"], [/airtable/i, "connector-airtable"], [/canva/i, "connector-canva"], [/todoist/i, "connector-todoist"],
  [/\bweb\b|\bsearch|\bonline\b|internet/i, "exa"], [/\bbrows(e|ing)\b/i, "browser"],
];

const APP_WORDS: [RegExp, PlatformId][] = [
  [/slack/i, "slack"], [/telegram/i, "telegram"], [/discord/i, "discord"], [/whats ?app/i, "whatsapp"],
  [/\bteams\b|microsoft teams/i, "teams"], [/signal/i, "signal"], [/\bsms\b|text message/i, "sms"], [/e-?mail/i, "email"],
];

/** A plan from the words alone: roles by keyword, a lead when there are three or more, named tools and chat apps. */
export function quickPlan(request: string): HarnessPlan {
  const text = request.trim();
  const roles = ROLES.filter((r) => r.match.test(text)).slice(0, 5);
  let agents: PlanAgent[] = roles.map((r) => ({ ...r.agent(), tools: [...(r.tools ?? [])] }));
  if (agents.length === 0) agents = [own("Assistant", text.slice(0, 150) || "Helps with everyday work.", "Be brief and practical.\nAsk one question when something is unclear.")];
  const tools = TOOL_WORDS.filter(([re]) => re.test(text)).map(([, id]) => id);
  for (const a of agents) a.tools = [...new Set([...a.tools, ...tools])].slice(0, 4);
  // The loop layer: only when asked to keep it short or cheap (Hermes' own default is no cap).
  if (/quick|cheap|budget|fast|short/i.test(text)) for (const a of agents) a.maxSteps = 25;

  const handoffs: [string, string][] = [];
  if (agents.length >= 3) {
    const lead = own("Lead", "Plans the work and hands it out.", `You lead this team: ${agents.map((a) => a.name).join(", ")}.\nSplit each request into tasks, hand them out, check the results, then answer.`);
    for (const a of agents) handoffs.push([lead.name, a.name]);
    agents = [lead, ...agents];
  } else if (agents.length === 2) handoffs.push([agents[0]!.name, agents[1]!.name]);
  agents[0]!.chatApps = APP_WORDS.filter(([re]) => re.test(text)).map(([, id]) => id).slice(0, 3);

  const names = agents.map((a) => a.name);
  const summary = agents.length === 1
    ? `${names[0]}: ${agents[0]!.about}`
    : `${names.length} agents: ${names.join(", ")}${handoffs.length ? `; ${handoffs[0]![0]} hands work to ${handoffs.filter(([f]) => f === handoffs[0]![0]).map(([, t]) => t).join(", ")}` : ""}.`;
  return restrictPlan({ summary, agents, handoffs }, PLAN_CHOICES);
}

const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * The blocks a plan adds to `graph`: its agents below what is there (the first on top), each wired
 * to `model` (or one new model), their tools and chat apps beside them, and the hand-offs. Profile
 * names are made unique; the skills come back to install once the agents are compiled.
 */
export function planToBoard(plan: HarnessPlan, graph: Graph, model: ModelNode | null, newModel: (pos: { x: number; y: number }) => GraphNode): { nodes: GraphNode[]; edges: GraphEdge[]; lead: string; skills: { profile: string; who: string; ids: readonly string[] }[] } {
  const p = restrictPlan(plan, PLAN_CHOICES);
  const taken = new Set(graph.nodes.filter((n) => n.kind === "agent").map((n) => String(n.data.name)));
  const toolNames = new Set(graph.nodes.filter((n) => n.kind === "tool").map((n) => String(n.data.name)));
  const top = Math.max(0, ...graph.nodes.map((n) => n.position.y + 200));
  const left = Math.min(0, ...graph.nodes.map((n) => n.position.x));
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const modelNode = model ?? newModel({ x: left, y: top + 120 });
  if (!model) nodes.push(modelNode);
  const ids = new Map<string, string>();
  const skills: { profile: string; who: string; ids: readonly string[] }[] = [];
  const workGraph: Graph = { ...graph, nodes: [...graph.nodes] };
  /** One block per tool, shared by every agent in the plan that uses it. */
  const toolBlocks = new Map<string, string>();
  /** One maker per kind, shared the same way. */
  const makerBlocks = new Map<string, string>();
  const makerNames = new Set(graph.nodes.filter((n) => n.kind === "media").map((n) => String(n.data.name)));
  const others = p.agents.length - 1;

  p.agents.forEach((a, i) => {
    const profile = agentIdFor(a.name, new Set([...taken, ...RESERVED_PROFILE_NAMES]));
    taken.add(profile);
    const id = `agent-${uid()}`;
    ids.set(a.name.toLowerCase(), id);
    const position = i === 0 ? { x: left + 340 + (Math.max(0, others - 1) * 280) / 2, y: top } : { x: left + 340 + (i - 1) * 280, y: top + 260 };
    nodes.push({ id, kind: "agent", position, data: { name: profile, displayName: a.name, description: a.about, soul: withRichAnswers(a.soul), skills: [], capabilities: null, ...(a.maxSteps ? { maxSteps: a.maxSteps } : {}) } });
    edges.push({ id: `edge-${uid()}`, source: modelNode.id, target: id, order: 0 });
    if (a.skills.length) skills.push({ profile, who: a.name, ids: a.skills });
    a.tools.forEach((t, k) => {
      let block = toolBlocks.get(t);
      if (!block) {
        const node = catalogNode(TOOLS.find((x) => x.id === t)!, toolNames, { x: position.x + 40 + k * 30, y: position.y + 150 + k * 70 });
        toolNames.add(String(node.data.name));
        nodes.push(node);
        toolBlocks.set(t, (block = node.id));
      }
      edges.push({ id: `edge-${uid()}`, source: id, target: block, order: 0 });
    });
    a.makers.forEach((media, k) => {
      let block = makerBlocks.get(media);
      if (!block) {
        let name = media === "image" ? "images" : "videos";
        for (let n = 2; makerNames.has(name); n++) name = `${media === "image" ? "images" : "videos"}-${n}`;
        makerNames.add(name);
        block = `maker-${uid()}`;
        nodes.push({ id: block, kind: "media", position: { x: position.x + 60 + k * 30, y: position.y + 170 + (a.tools.length + k) * 70 }, data: { name, label: media === "image" ? "Images" : "Videos", media, provider: makerProvider({ nodes: [...graph.nodes, ...nodes] }, media), model: "" } });
        makerBlocks.set(media, block);
      }
      edges.push({ id: `edge-${uid()}`, source: id, target: block, order: 0 });
    });
    a.chatApps.forEach((c, k) => {
      const node = newChannel(workGraph, c as PlatformId, { x: position.x - 260, y: position.y + k * 90 });
      workGraph.nodes.push(node);
      nodes.push(node);
      edges.push({ id: `edge-${uid()}`, source: id, target: node.id, order: 0 });
    });
  });
  for (const [from, to] of p.handoffs) {
    const s = ids.get(from.toLowerCase());
    const t = ids.get(to.toLowerCase());
    if (s && t) edges.push({ id: `edge-${uid()}`, source: s, target: t, order: 0 });
  }
  return { nodes, edges, lead: ids.get(p.agents[0]!.name.toLowerCase())!, skills };
}
