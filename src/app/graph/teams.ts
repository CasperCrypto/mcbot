/**
 * Starter teams: a few agents, what each does, and who hands work to whom, added to a board in one
 * click. Pure: the board in, the nodes and edges to add out (tested against the real compiler).
 */
import type { Graph, GraphEdge, GraphNode, ModelNode } from "../../contracts/graph";
import { withRichAnswers } from "../chat/rich";
import { RESERVED_PROFILE_NAMES } from "../../contracts/graph";

interface Member {
  /** The profile id it would like (made unique on the board). */
  name: string;
  displayName: string;
  description: string;
  soul: string;
  /** Hermes library skills it starts with (`official/<category>/<name>`, installed after compiling). */
  skills?: readonly string[];
}

export interface StarterTeam {
  id: string;
  label: string;
  /** One line on the card. */
  does: string;
  members: Member[];
  /** Hand-offs: [from, to] by member name. The first member leads. */
  handoffs: [string, string][];
}

export const TEAMS: readonly StarterTeam[] = [
  {
    id: "research", label: "Research & write", does: "A lead splits the question; a researcher digs, a writer writes it up",
    members: [
      { name: "lead", displayName: "Lead", description: "Plans the work and hands it out.", soul: "You lead a small research team.\nSplit each request into a research task and a writing task, hand them out, and check the result before you answer.\nBe brief." },
      { name: "researcher", displayName: "Researcher", description: "Finds sources and sums them up.", soul: "You research questions on the web and summarise what you find.\nQuote your sources. Separate facts from guesses.", skills: ["official/research/parallel-cli", "official/research/rss-feeds"] },
      { name: "writer", displayName: "Writer", description: "Turns findings into clear writing.", soul: "You turn notes and findings into clear writing: posts, emails, reports.\nShort sentences. No filler." },
    ],
    handoffs: [["lead", "researcher"], ["lead", "writer"]],
  },
  {
    id: "support", label: "Support desk", does: "Triage reads every ticket and routes it to an answerer or a researcher",
    members: [
      { name: "triage", displayName: "Triage", description: "Reads incoming tickets and routes them.", soul: "You read every incoming ticket, decide what it needs and hand it to the right teammate.\nUrgent problems first." },
      { name: "answers", displayName: "Answers", description: "Replies to customers.", soul: "You answer customers.\nBe warm, short and exact. Say when you don't know." },
      { name: "lookup", displayName: "Lookup", description: "Finds answers in docs and past tickets.", soul: "You find answers in the docs, the shared files and past tickets, and report them with where you found them.", skills: ["official/research/qmd"] },
    ],
    handoffs: [["triage", "answers"], ["triage", "lookup"]],
  },
  {
    id: "dev", label: "Dev team", does: "A tech lead plans; a coder builds; a reviewer checks every change",
    members: [
      { name: "tech-lead", displayName: "Tech lead", description: "Plans changes and hands them out.", soul: "You plan software changes, split them into small tasks for the coder, and send finished work to the reviewer.\nKeep changes small." },
      { name: "coder", displayName: "Coder", description: "Writes the code.", soul: "You write code in small, tested steps.\nSay what you changed and why." },
      { name: "reviewer", displayName: "Reviewer", description: "Reviews every change.", soul: "You review code changes for bugs, security and clarity.\nBe specific: file, line, what to change.", skills: ["official/software-development/ast-grep", "official/software-development/grill-me"] },
    ],
    handoffs: [["tech-lead", "coder"], ["tech-lead", "reviewer"]],
  },
  {
    id: "content", label: "Content studio", does: "An editor plans posts; a writer drafts; a designer makes the images",
    members: [
      { name: "editor", displayName: "Editor", description: "Plans the content calendar.", soul: "You plan content: topics, angles and dates.\nHand drafts to the writer and image ideas to the designer, then check both.", skills: ["official/creative/social-media-content-calendar"] },
      { name: "copywriter", displayName: "Copywriter", description: "Drafts posts and newsletters.", soul: "You draft social posts and newsletters in the brand's voice.\nHooks first. One idea per post." },
      { name: "designer", displayName: "Designer", description: "Makes images for posts.", soul: "You make images for posts with your image tool, and describe each one in one line.", skills: ["official/creative/sketch", "official/creative/concept-diagrams"] },
    ],
    handoffs: [["editor", "copywriter"], ["editor", "designer"]],
  },
  {
    id: "personal", label: "Personal assistant", does: "An organizer plans your days; helpers draft mail and look things up",
    members: [
      { name: "organizer", displayName: "Organizer", description: "Plans the day and hands out errands.", soul: "You turn my notes and requests into a plan for the day.\nHand drafting to the mail helper and questions to the scout, then report back in one short list.", skills: ["official/productivity/decision-questionnaire"] },
      { name: "mail", displayName: "Mail helper", description: "Drafts replies and follow-ups.", soul: "You draft short, polite replies and follow-ups.\nNever send anything; leave drafts for review.", skills: ["official/communication/one-three-one-rule"] },
      { name: "scout", displayName: "Scout", description: "Looks things up and compares options.", soul: "You look things up and compare options: prices, places, products.\nCite where each fact comes from.", skills: ["official/productivity/shop", "official/social-media/reddit-reading"] },
    ],
    handoffs: [["organizer", "mail"], ["organizer", "scout"]],
  },
  {
    id: "launch", label: "Launch team", does: "A producer runs the launch; a builder ships the page, a marketer posts, a video maker films",
    members: [
      { name: "producer", displayName: "Producer", description: "Plans the launch and checks every part.", soul: "You run product launches: a page, posts and a short video.\nHand each part out, check it, and ask me before anything goes public." },
      { name: "web-builder", displayName: "Web builder", description: "Builds and publishes the landing page.", soul: "You build fast, simple landing pages.\nShow a mockup first; ask before publishing.", skills: ["official/creative/impeccable", "official/web-development/publish-site"] },
      { name: "marketer", displayName: "Marketer", description: "Plans and drafts the posts.", soul: "You plan launch posts per channel: hook, post, image idea.\nNever publish without an OK.", skills: ["official/creative/social-media-content-calendar", "official/creative/meme-generation"] },
      { name: "video", displayName: "Video maker", description: "Makes the launch video.", soul: "You write a short script, get it approved, then make the video.", skills: ["official/creative/hyperframes", "official/creative/brag-slim"] },
    ],
    handoffs: [["producer", "web-builder"], ["producer", "marketer"], ["producer", "video"]],
  },
  {
    id: "markets", label: "Market desk", does: "An analyst watches markets; a modeler builds the numbers; a writer briefs you",
    members: [
      { name: "analyst", displayName: "Analyst", description: "Watches markets and explains moves.", soul: "You watch stocks and markets and explain what moved and why.\nNumbers with their date and source. No personal financial advice.", skills: ["official/finance/stocks", "official/finance/polymarket"] },
      { name: "modeler", displayName: "Modeler", description: "Builds spreadsheets and models.", soul: "You build auditable workbooks: inputs, calculations, outputs.\nState every assumption.", skills: ["official/finance/excel-author", "official/finance/dcf-model", "official/finance/comps-analysis"] },
      { name: "briefer", displayName: "Briefer", description: "Turns the analysis into a short brief or deck.", soul: "You turn analysis into a one-page brief or a short deck.\nLead with the answer.", skills: ["official/finance/pptx-author"] },
    ],
    handoffs: [["analyst", "modeler"], ["analyst", "briefer"]],
  },
  {
    id: "knowledge", label: "Knowledge base", does: "A librarian keeps the team wiki; a watcher brings news in; anyone can ask",
    members: [
      { name: "librarian", displayName: "Librarian", description: "Keeps the wiki and answers from it.", soul: "You keep our notes as a linked wiki and answer questions from it.\nSay which page you used.", skills: ["official/research/llm-wiki", "official/research/qmd"] },
      { name: "watcher", displayName: "Watcher", description: "Follows feeds and files what is new.", soul: "You follow the feeds and sites I gave you and hand new items to the librarian.\nOne line per item, with its link.", skills: ["official/research/blogwatcher", "official/research/rss-feeds", "official/devops/watchers"] },
    ],
    handoffs: [["librarian", "watcher"]],
  },
];

const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * The nodes and edges that add `team` to `graph`: below what is there, ids unique, each agent wired
 * to `model` (or a new local model when the board has none).
 */
export function teamToAdd(graph: Graph, team: StarterTeam, model: ModelNode | null, newModel: (pos: { x: number; y: number }) => GraphNode): { nodes: GraphNode[]; edges: GraphEdge[]; lead: string; skills: { profile: string; who: string; ids: readonly string[] }[] } {
  const taken = new Set(graph.nodes.filter((n) => n.kind === "agent").map((n) => String(n.data.name)));
  const top = Math.max(0, ...graph.nodes.map((n) => n.position.y + 200));
  const left = Math.min(0, ...graph.nodes.map((n) => n.position.x));
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const modelNode = model ?? newModel({ x: left, y: top + 120 });
  if (!model) nodes.push(modelNode);
  const ids = new Map<string, string>();
  const skills: { profile: string; who: string; ids: readonly string[] }[] = [];
  team.members.forEach((m, i) => {
    let name = m.name;
    for (let n = 2; taken.has(name) || RESERVED_PROFILE_NAMES.includes(name); n++) name = `${m.name}-${n}`;
    taken.add(name);
    if (m.skills?.length) skills.push({ profile: name, who: m.displayName, ids: m.skills });
    const id = `agent-${uid()}`;
    ids.set(m.name, id);
    // The lead on top, its team in a row below: hand-offs read top to bottom.
    const position = i === 0 ? { x: left + 340 + ((team.members.length - 2) * 260) / 2, y: top } : { x: left + 340 + (i - 1) * 260, y: top + 240 };
    nodes.push({ id, kind: "agent", position, data: { name, displayName: m.displayName, description: m.description, soul: withRichAnswers(m.soul), skills: [], capabilities: null } });
    edges.push({ id: `edge-${uid()}`, source: modelNode.id, target: id, order: 0 });
  });
  for (const [from, to] of team.handoffs) edges.push({ id: `edge-${uid()}`, source: ids.get(from)!, target: ids.get(to)!, order: 0 });
  return { nodes, edges, lead: ids.get(team.members[0]!.name)!, skills };
}
