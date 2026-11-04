/**
 * Starter agents for the setup assistant, and the board they become.
 * Pure: answers in, graph out, so it is tested against the real compiler.
 */
import type { SetupKind, SetupProfile } from "../../contracts/api";
import type { Graph, GraphEdge, GraphNode } from "../../contracts/graph";

export interface Preset {
  id: string;
  /** Hermes profile id. */
  name: string;
  displayName: string;
  /** One line, shown on the card. */
  role: string;
  soul: string;
  /** Gets the shared files tool. */
  files: boolean;
  for: SetupKind[];
  /** Ticked by default for these kinds. */
  pick: SetupKind[];
}

export const PRESETS: Preset[] = [
  {
    id: "assistant", name: "assistant", displayName: "Assistant", role: "Plans your day, drafts messages, keeps notes",
    soul: "You are a personal assistant.\nKeep track of plans, draft messages and remember what matters.\nBe brief and ask before acting for someone.",
    files: true, for: ["personal", "team", "company"], pick: ["personal"],
  },
  {
    id: "support", name: "support", displayName: "Support desk", role: "Answers customers and routes tickets",
    soul: "You answer customer questions and route tickets to the right person.\nBe warm, short and exact. Say when you don't know.",
    files: true, for: ["team", "company"], pick: ["team", "company"],
  },
  {
    id: "researcher", name: "researcher", displayName: "Researcher", role: "Finds sources and sums them up",
    soul: "You research questions and summarise what you find.\nQuote your sources. Separate facts from guesses.",
    files: true, for: ["personal", "team", "company"], pick: ["personal", "team", "company"],
  },
  {
    id: "writer", name: "writer", displayName: "Writer", role: "Drafts posts, emails and docs",
    soul: "You draft and edit writing: posts, emails, docs.\nMatch the reader. Short sentences. No filler.",
    files: true, for: ["personal", "team", "company"], pick: [],
  },
  {
    id: "sales", name: "sales", displayName: "Sales", role: "Researches leads and drafts outreach",
    soul: "You research leads and draft outreach.\nPersonal, specific, never pushy.",
    files: true, for: ["team", "company"], pick: ["company"],
  },
  {
    id: "ops", name: "ops", displayName: "Operations", role: "Keeps checklists, reports and schedules",
    soul: "You keep operations running: checklists, weekly reports, schedules.\nFlag what is late or at risk.",
    files: true, for: ["team", "company"], pick: [],
  },
  {
    id: "coder", name: "coder", displayName: "Coder", role: "Writes and reviews code",
    soul: "You write, explain and review code.\nPrefer small, tested changes. Say what you changed and why.",
    files: true, for: ["personal", "team", "company"], pick: [],
  },
];

export const presetsFor = (kind: SetupKind) => PRESETS.filter((p) => p.for.includes(kind));
export const defaultPicks = (kind: SetupKind) => PRESETS.filter((p) => p.pick.includes(kind)).map((p) => p.id);

export interface ModelChoice {
  endpoint: "local" | "cloud";
  label: string;
  baseUrl: string;
  model: string;
  /** Env var name of the API key (cloud). */
  apiKeyEnv: string;
}

/** Trimmed, ending in a full stop. */
const sentence = (s: string) => {
  const t = s.trim();
  return !t || /[.!?]$/.test(t) ? t : `${t}.`;
};

/** Who the agents work for: appended to every soul. */
export function contextLines(p: SetupProfile): string {
  const lines: string[] = [];
  if (p.kind === "personal") {
    if (p.name) lines.push(`You work for ${p.name}.`);
    if (p.about) lines.push(`They want help with: ${sentence(p.about)}`);
  } else {
    if (p.company) lines.push(`You work at ${p.company}.${p.about ? ` ${sentence(p.about)}` : ""}`);
    if (p.name) lines.push(`You report to ${p.name}${p.role ? `, ${p.role}` : ""}.`);
  }
  return lines.join("\n");
}

/** What every agent should know about the person from day one (Hermes USER.md, 1375 chars max). */
export function userFacts(p: SetupProfile): string {
  const parts: string[] = [];
  if (p.kind === "personal") {
    if (p.name) parts.push(`The user is ${p.name}.`);
    if (p.about) parts.push(`Wants help with: ${sentence(p.about)}`);
  } else {
    if (p.name) parts.push(`The user is ${p.name}${p.role ? `, ${p.role}` : ""}${p.company ? ` at ${p.company}` : ""}.`);
    if (p.company && p.about) parts.push(`${p.company}: ${sentence(p.about)}`);
  }
  return parts.join(" ").slice(0, 1300);
}

export function boardName(p: SetupProfile): string {
  if (p.kind !== "personal" && p.company.trim()) return p.company.trim();
  return p.name.trim() ? `${p.name.trim()}'s agents` : "My agents";
}

/**
 * The team as a board: models on the left (first is primary, the next is its
 * fallback), agents in the middle, the shared files tool on the right.
 */
export function buildTeam(profile: SetupProfile, picks: string[], models: ModelChoice[], workspace: string): Graph {
  const chosen = PRESETS.filter((p) => picks.includes(p.id));
  const context = contextLines(profile);
  const rowY = (i: number, n: number) => (i - (n - 1) / 2) * 230;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const modelIds = models.map((m, i) => {
    const id = `model-${m.endpoint}`;
    nodes.push({
      id, kind: "model", position: { x: -400, y: rowY(i, models.length) },
      data: { name: m.endpoint, label: m.label, endpoint: m.endpoint, baseUrl: m.baseUrl, model: m.model, apiKeyEnv: m.endpoint === "cloud" ? m.apiKeyEnv : "", pricing: null },
    });
    return id;
  });

  const anyFiles = chosen.some((p) => p.files);
  if (anyFiles) {
    nodes.push({
      id: "tool-files", kind: "tool", position: { x: 400, y: 0 },
      data: {
        name: "files", label: "Shared files", transport: "stdio", command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", `${workspace.replace(/[\\/]+$/, "")}/files`], env: {}, url: "", headers: {},
      },
    });
  }

  chosen.forEach((p, i) => {
    const id = `agent-${p.id}`;
    nodes.push({
      id, kind: "agent", position: { x: 0, y: rowY(i, chosen.length) },
      data: { name: p.name, displayName: p.displayName, description: p.role, soul: context ? `${p.soul}\n\n${context}` : p.soul, skills: [] },
    });
    modelIds.forEach((m, order) => edges.push({ id: `e-${m}-${p.id}`, source: m, target: id, order }));
    if (p.files) edges.push({ id: `e-${p.id}-files`, source: id, target: "tool-files", order: 0 });
  });

  return { schema: "mcbot.graph/v1", id: "setup", name: boardName(profile), nodes, edges } as Graph;
}
