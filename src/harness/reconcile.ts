/**
 * Hermes → open board (decision 9, step c): one agent's files changed (in McBot's editor, with the
 * Hermes CLI, or by an agent itself), so the board follows. Pure: given the board and the agent's
 * files, it returns the smallest list of board edits that makes compiling the board give those
 * files again. The engine applies them to the live board, so everyone looking sees them.
 *
 * McBot-only things stay: positions, labels, prices, notes, chat-app tokens.
 */
import { compiledToolsets } from "../compile/config";
import { renderSkill } from "../compile/skill";
import { renderSoul } from "../compile/soul";
import { canonicalText } from "../compile/text";
import { resolveGraph } from "../compile/validate";
import type { AgentData, Graph, GraphEdge, GraphNode } from "../contracts/graph";
import { readHermes, splitSoul, type ProfileFiles, type Unshown } from "./read";

export type BoardEdit = (
  | { op: "set"; id: string; field: string; value: unknown }
  | { op: "add-node"; node: GraphNode }
  | { op: "add-edge"; edge: GraphEdge }
  | { op: "edge-order"; id: string; order: number }
  | { op: "remove-edges"; ids: string[] }
) & { /** What it changes, in a word ("soul", "model"). */ word?: string };

export interface Reconciled {
  /** Board edits, in order; empty when the board already matches the files. */
  edits: BoardEdit[];
  /** What the files hold that the board cannot show yet (kept in Hermes). */
  unshown: Unshown[];
  /** Short words for each change, for a toast ("Researcher: soul, model"). */
  changed: string[];
}

/** Equal as Hermes sees them: map key order does not matter, list order does. */
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]));
  return v ?? null;
}
const same = (a: unknown, b: unknown) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

/** The fields of each kind that reach Hermes (labels and prices are McBot's own). */
const HERMES_FIELDS: Record<string, readonly string[]> = {
  model: ["endpoint", "baseUrl", "model", "apiKeyEnv"],
  tool: ["transport", "command", "args", "env", "url", "headers"],
  media: ["provider", "model"],
};

function browserOf(b: AgentData["browser"]) {
  return { show: b?.show ?? false, engine: b?.engine ?? "chromium", myLogins: b?.myLogins ?? false };
}

/** Which node a read node is on the board: models and tools by name, makers by what they make. */
function matches(a: GraphNode, b: GraphNode): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "media" && b.kind === "media") return a.data.media === b.data.media;
  return a.data.name === b.data.name;
}

export function reconcile(input: Graph, files: ProfileFiles): Reconciled {
  const edits: BoardEdit[] = [];
  const changed = new Set<string>();
  // The board with its defaults filled in (a half-edited board still resolves what is valid).
  const { graph, bundles } = resolveGraph(input);
  const agent = graph.nodes.find((n): n is Extract<GraphNode, { kind: "agent" }> => n.kind === "agent" && n.data.name === files.name);
  const read = readHermes({ id: graph.id, name: graph.name }, [files]);
  if (!agent) return { edits, unshown: read.unshown, changed: [] };
  const bundle = bundles.find((b) => b.agent.id === agent.id);
  const theirs = read.graph.nodes.find((n) => n.kind === "agent")!.data as AgentData;
  const set = (id: string, field: string, value: unknown, word: string) => {
    edits.push({ op: "set", id, field, value, word });
    changed.add(word);
  };

  // Who the agent is. SOUL.md: compare what compile would write, so an empty board soul that
  // compile fills in ("# Name\n\nAbout") is not taken for a change.
  if (files.soul !== null) {
    const ours = splitSoul(renderSoul(agent.data).replace(/\n+$/, "")).own;
    if (canonicalText(ours) !== canonicalText(theirs.soul)) set(agent.id, "soul", theirs.soul, "soul");
  }
  if (files.profileYaml !== null || agent.data.displayName || agent.data.description) {
    if (theirs.displayName !== agent.data.displayName.trim()) set(agent.id, "displayName", theirs.displayName, "name");
    if (theirs.description !== agent.data.description.trim()) set(agent.id, "description", theirs.description, "description");
  }
  // Skills: compare the SKILL.md files compile would write with the ones on disk.
  const byName = (a: [string, string], b: [string, string]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const ourSkills = agent.data.skills.map((s): [string, string] => [s.name, renderSkill(s)]).sort(byName);
  const theirSkills = theirs.skills.map((s): [string, string] => [s.name, canonicalText(files.skills[s.name] ?? "")]).sort(byName);
  if (!same(ourSkills, theirSkills)) set(agent.id, "skills", theirs.skills, "skills");

  // A config.yaml that does not parse (half saved, a typo) says nothing about the board: leave it.
  const configReadable = files.config !== null && !read.unshown.some((u) => u.what === "config.yaml");
  if (configReadable) {
    // Abilities: compare the lists compile would write; null stays null when it still means the same.
    const ours = bundle ? compiledToolsets(bundle) : null;
    const theirsList = theirs.capabilities === null ? null : compiledToolsets({ ...(bundle ?? emptyBundle(agent)), agent: { ...agent, data: { ...agent.data, capabilities: theirs.capabilities } } });
    if (!same(ours, theirsList)) set(agent.id, "capabilities", theirs.capabilities, "abilities");
    if (!same(browserOf(agent.data.browser), browserOf(theirs.browser))) set(agent.id, "browser", theirs.browser, "browser");

    // Models, tools and makers wired to the agent.
    const modelUnshown = read.unshown.some((u) => u.what.startsWith("model "));
    const wired = graph.edges.filter((e) => e.source === agent.id || e.target === agent.id);
    const other = (e: GraphEdge) => (e.source === agent.id ? e.target : e.source);
    const wiredNodes = wired.map((e) => ({ edge: e, node: graph.nodes.find((n) => n.id === other(e)) })).filter((x): x is { edge: GraphEdge; node: GraphNode } => !!x.node);
    const readEdges = read.graph.edges.filter((e) => e.source === `n-agent-${files.name}`);
    const kept = new Set<string>();
    let added = 0;

    for (const re of readEdges) {
      const r = read.graph.nodes.find((n) => n.id === re.target);
      if (!r || !(r.kind in HERMES_FIELDS)) continue;
      if (r.kind === "model" && modelUnshown) continue;
      const word = r.kind === "media" ? `${(r.data as { media: string }).media} maker` : r.kind;
      const onBoard = wiredNodes.find((w) => matches(w.node, r));
      if (onBoard) {
        kept.add(onBoard.edge.id);
        for (const f of HERMES_FIELDS[r.kind]!) {
          const v = (r.data as Record<string, unknown>)[f];
          if (!same((onBoard.node.data as Record<string, unknown>)[f], v)) set(onBoard.node.id, f, v, word);
        }
        if (r.kind === "model" && onBoard.edge.order !== re.order) {
          edits.push({ op: "edge-order", id: onBoard.edge.id, order: re.order, word: "model" });
          changed.add("model");
        }
        continue;
      }
      // A node the board already has elsewhere, identical: wire it. Otherwise a new one by the agent.
      const fields = HERMES_FIELDS[r.kind]!;
      const elsewhere = graph.nodes.find((n) => matches(n, r) && fields.every((f) => same((n.data as Record<string, unknown>)[f], (r.data as Record<string, unknown>)[f])));
      let id = elsewhere?.id;
      if (!id) {
        const taken = new Set(graph.nodes.map((n) => n.id));
        let base = `n-${files.name}-${r.kind}-${r.data.name}`;
        for (let i = 2; taken.has(base); i++) base = `n-${files.name}-${r.kind}-${r.data.name}-${i}`;
        id = base;
        const x = agent.position.x + (r.kind === "model" ? -320 : 320);
        edits.push({ op: "add-node", node: { ...r, id, position: { x, y: agent.position.y + 120 * added++ } } as GraphNode, word });
      }
      edits.push({ op: "add-edge", edge: { id: `e-${agent.id}-${id}`, source: agent.id, target: id, order: re.order }, word });
      changed.add(word);
    }
    // Wired on the board but gone from config.yaml: unwire (the node stays for other agents).
    const gone = wiredNodes
      .filter((w) => w.node.kind in HERMES_FIELDS && !kept.has(w.edge.id) && !(w.node.kind === "model" && modelUnshown))
      .map((w) => w.edge.id);
    if (gone.length) {
      edits.push({ op: "remove-edges", ids: gone, word: "wiring" });
      for (const w of wiredNodes) if (gone.includes(w.edge.id)) changed.add(w.node.kind === "media" ? "maker" : w.node.kind);
    }
  }

  // Hand-offs: the Team section of SOUL.md lists who this agent gives work to.
  if (files.soul !== null) {
    const team = new Set(splitSoul(files.soul.replace(/\n+$/, "")).team);
    const agents = graph.nodes.filter((n) => n.kind === "agent");
    const handoffs = graph.edges.filter((e) => e.source === agent.id && agents.some((a) => a.id === e.target));
    const drop = handoffs.filter((e) => !team.has((agents.find((a) => a.id === e.target)!.data as AgentData).name)).map((e) => e.id);
    if (drop.length) edits.push({ op: "remove-edges", ids: drop, word: "team" });
    for (const name of team) {
      const to = agents.find((a) => (a.data as AgentData).name === name);
      if (to && !handoffs.some((e) => e.target === to.id)) edits.push({ op: "add-edge", edge: { id: `e-${agent.id}-${to.id}`, source: agent.id, target: to.id, order: 0 }, word: "team" });
    }
    if (drop.length || [...team].some((n) => agents.some((a) => (a.data as AgentData).name === n && !handoffs.some((e) => e.target === a.id)))) changed.add("team");
  }

  return { edits, unshown: read.unshown, changed: [...changed] };
}

/**
 * Three-way: only what changed in Hermes' files since McBot last saw them (`base`) reaches the
 * board. A board edit not compiled yet stays, unless the files changed that same thing (then the
 * files win, as the newer change). Without a base, every difference is taken from the files.
 */
export function followChanges(graph: Graph, base: ProfileFiles | null, now: ProfileFiles): Reconciled {
  const next = reconcile(graph, now);
  if (!base) return next;
  const pending = new Set(reconcile(graph, base).edits.map((e) => JSON.stringify(e)));
  const edits = next.edits.filter((e) => !pending.has(JSON.stringify(e)));
  return { edits, unshown: next.unshown, changed: [...new Set(edits.map((e) => e.word ?? "board"))] };
}

function emptyBundle(agent: Extract<GraphNode, { kind: "agent" }>) {
  return { agent, models: [], tools: [], image: null, video: null, channels: [], team: [] };
}

/** Apply edits to a plain board (the demo; the engine applies them to the live Y.Doc). */
export function applyEdits(graph: Graph, edits: readonly BoardEdit[]): Graph {
  const g: Graph = structuredClone(graph);
  for (const e of edits) {
    if (e.op === "set") {
      const n = g.nodes.find((x) => x.id === e.id);
      if (n) (n.data as Record<string, unknown>)[e.field] = structuredClone(e.value);
    } else if (e.op === "add-node") g.nodes.push(structuredClone(e.node));
    else if (e.op === "add-edge") g.edges.push({ ...e.edge });
    else if (e.op === "edge-order") {
      const x = g.edges.find((y) => y.id === e.id);
      if (x) x.order = e.order;
    } else g.edges = g.edges.filter((x) => !e.ids.includes(x.id));
  }
  return g;
}
