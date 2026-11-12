/**
 * Starter teams: a few agents, what each does, and who hands work to whom, added to a board in one
 * click. Pure: the board in, the nodes and edges to add out (tested against the real compiler).
 */
import type { Graph, GraphEdge, GraphNode, ModelNode } from "../../contracts/graph";
import { RESERVED_PROFILE_NAMES } from "../../contracts/graph";

interface Member {
  /** The profile id it would like (made unique on the board). */
  name: string;
  displayName: string;
  description: string;
  soul: string;
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
      { name: "researcher", displayName: "Researcher", description: "Finds sources and sums them up.", soul: "You research questions on the web and summarise what you find.\nQuote your sources. Separate facts from guesses." },
      { name: "writer", displayName: "Writer", description: "Turns findings into clear writing.", soul: "You turn notes and findings into clear writing: posts, emails, reports.\nShort sentences. No filler." },
    ],
    handoffs: [["lead", "researcher"], ["lead", "writer"]],
  },
  {
    id: "support", label: "Support desk", does: "Triage reads every ticket and routes it to an answerer or a researcher",
    members: [
      { name: "triage", displayName: "Triage", description: "Reads incoming tickets and routes them.", soul: "You read every incoming ticket, decide what it needs and hand it to the right teammate.\nUrgent problems first." },
      { name: "answers", displayName: "Answers", description: "Replies to customers.", soul: "You answer customers.\nBe warm, short and exact. Say when you don't know." },
      { name: "lookup", displayName: "Lookup", description: "Finds answers in docs and past tickets.", soul: "You find answers in the docs, the shared files and past tickets, and report them with where you found them." },
    ],
    handoffs: [["triage", "answers"], ["triage", "lookup"]],
  },
  {
    id: "dev", label: "Dev team", does: "A tech lead plans; a coder builds; a reviewer checks every change",
    members: [
      { name: "tech-lead", displayName: "Tech lead", description: "Plans changes and hands them out.", soul: "You plan software changes, split them into small tasks for the coder, and send finished work to the reviewer.\nKeep changes small." },
      { name: "coder", displayName: "Coder", description: "Writes the code.", soul: "You write code in small, tested steps.\nSay what you changed and why." },
      { name: "reviewer", displayName: "Reviewer", description: "Reviews every change.", soul: "You review code changes for bugs, security and clarity.\nBe specific: file, line, what to change." },
    ],
    handoffs: [["tech-lead", "coder"], ["tech-lead", "reviewer"]],
  },
  {
    id: "content", label: "Content studio", does: "An editor plans posts; a writer drafts; a designer makes the images",
    members: [
      { name: "editor", displayName: "Editor", description: "Plans the content calendar.", soul: "You plan content: topics, angles and dates.\nHand drafts to the writer and image ideas to the designer, then check both." },
      { name: "copywriter", displayName: "Copywriter", description: "Drafts posts and newsletters.", soul: "You draft social posts and newsletters in the brand's voice.\nHooks first. One idea per post." },
      { name: "designer", displayName: "Designer", description: "Makes images for posts.", soul: "You make images for posts with your image tool, and describe each one in one line." },
    ],
    handoffs: [["editor", "copywriter"], ["editor", "designer"]],
  },
];

const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * The nodes and edges that add `team` to `graph`: below what is there, ids unique, each agent wired
 * to `model` (or a new local model when the board has none).
 */
export function teamToAdd(graph: Graph, team: StarterTeam, model: ModelNode | null, newModel: (pos: { x: number; y: number }) => GraphNode): { nodes: GraphNode[]; edges: GraphEdge[]; lead: string } {
  const taken = new Set(graph.nodes.filter((n) => n.kind === "agent").map((n) => String(n.data.name)));
  const top = Math.max(0, ...graph.nodes.map((n) => n.position.y + 200));
  const left = Math.min(0, ...graph.nodes.map((n) => n.position.x));
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const modelNode = model ?? newModel({ x: left, y: top + 120 });
  if (!model) nodes.push(modelNode);
  const ids = new Map<string, string>();
  team.members.forEach((m, i) => {
    let name = m.name;
    for (let n = 2; taken.has(name) || RESERVED_PROFILE_NAMES.includes(name); n++) name = `${m.name}-${n}`;
    taken.add(name);
    const id = `agent-${uid()}`;
    ids.set(m.name, id);
    // The lead on top, its team in a row below: hand-offs read top to bottom.
    const position = i === 0 ? { x: left + 340 + ((team.members.length - 2) * 260) / 2, y: top } : { x: left + 340 + (i - 1) * 260, y: top + 240 };
    nodes.push({ id, kind: "agent", position, data: { name, displayName: m.displayName, description: m.description, soul: m.soul, skills: [], capabilities: null } });
    edges.push({ id: `edge-${uid()}`, source: modelNode.id, target: id, order: 0 });
  });
  for (const [from, to] of team.handoffs) edges.push({ id: `edge-${uid()}`, source: ids.get(from)!, target: ids.get(to)!, order: 0 });
  return { nodes, edges, lead: ids.get(team.members[0]!.name)! };
}
