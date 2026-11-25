/** Make an agent: a name and what it does (or a starting card), and the model it thinks with. The rest is on its page. */
import { X } from "lucide-react";
import { withRichAnswers } from "../chat/rich";
import { useEffect, useMemo, useState } from "react";
import { addEdge, addNode } from "../../board/ydoc";
import { RESERVED_PROFILE_NAMES, type GraphNode, type ModelNode } from "../../contracts/graph";
import { compileBoard, learnSkills, skillName } from "../actions";
import { prettyName } from "../lib/names";
import { newAgent, newId, newMaker, newModel } from "../graph/defaults";
import { CATALOG, CONNECTOR_TOOLS, catalogNode } from "../graph/catalog";
import { makerProvider } from "../graph/teams";
import { freeSpot } from "../graph/place";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { AgentFace } from "../ui";
import { Logo } from "../faces/FoodFace";
import { usePresence } from "../lib/presence";
import { AGENT_GROUPS, AGENT_SUGGESTIONS, agentIdFor } from "./agentSuggestions";
import { REMOTE } from "../lib/engine";
import { Picker } from "../Picker";
import { ModelMark } from "../graph/Logo";
import { modelName } from "../lib/modelName";

export { agentIdFor };

export function NewAgentSheet() {
  const open = useApp((s) => s.newAgentOpen);
  const setOpen = useApp((s) => s.setNewAgentOpen);
  const { doc, graph, boardId } = useBoard();
  const models = useMemo(() => graph.nodes.filter((n): n is ModelNode => n.kind === "model"), [graph]);
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [soul, setSoul] = useState("");
  const [model, setModel] = useState<string>("");
  /** Hermes library skills the picked starting card comes with (installed after the first compile). */
  const [skills, setSkills] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [group, setGroup] = useState<"All" | (typeof AGENT_GROUPS)[number]>("All");

  useEffect(() => {
    if (!open) return;
    setName("");
    setAbout("");
    setSoul("");
    setSkills([]);
    setModel(models[0]?.id ?? "new-local");
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stays a moment after closing, to leave the way it came (lib/presence.ts).
  const presence = usePresence(open);
  if (!presence.mounted) return null;
  const taken = new Set(graph.nodes.filter((n) => n.kind === "agent").map((n) => String(n.data.name)));
  const id = agentIdFor(name, taken);

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const app = useApp.getState();
    const base = newAgent(graph, freeSpot(graph, "agent", null, null)) as Extract<GraphNode, { kind: "agent" }>;
    const agent: GraphNode = { ...base, data: { ...base.data, name: id, displayName: name.trim(), description: about.trim(), soul: withRichAnswers(soul.trim()) } };
    let modelId = model;
    doc.transact(() => {
      addNode(doc, agent);
      if (model === "new-local" || model === "new-cloud") {
        const m = newModel(graph, model === "new-local" ? "local" : "cloud", { x: agent.position.x - 320, y: agent.position.y });
        addNode(doc, m);
        modelId = m.id;
      }
      addEdge(doc, { id: newId("edge"), source: modelId, target: agent.id, order: 0 });
      // What the card does it does itself: its maker (images, videos) and tools come with it.
      const card = AGENT_SUGGESTIONS.find((x) => x.name === name.trim());
      const names = new Set(graph.nodes.filter((n) => n.kind === "tool").map((n) => String(n.data.name)));
      (card?.tools ?? []).forEach((toolId, k) => {
        const t = [...CATALOG, ...CONNECTOR_TOOLS].find((x) => x.id === toolId);
        if (!t) return;
        const existing = graph.nodes.find((n) => n.kind === "tool" && n.data.name === t.name);
        const node = existing ?? catalogNode(t, names, { x: agent.position.x + 300, y: agent.position.y + k * 90 });
        if (!existing) addNode(doc, node);
        addEdge(doc, { id: newId("edge"), source: agent.id, target: node.id, order: 0 });
      });
      (card?.makers ?? []).forEach((media, k) => {
        const maker = newMaker(graph, media, { x: agent.position.x + 300, y: agent.position.y + ((card?.tools?.length ?? 0) + k) * 90 });
        const node = { ...maker, data: { ...maker.data, provider: makerProvider(graph, media) } } as GraphNode;
        addNode(doc, node);
        addEdge(doc, { id: newId("edge"), source: agent.id, target: node.id, order: 0 });
      });
    });
    setOpen(false);
    setBusy(false);
    app.select(agent.id);
    // Ready to talk to straight away when the board compiles; otherwise the graph shows what is missing.
    if (await compileBoard(boardId, { quiet: true })) {
      app.editAgent(agent.id);
      if (skills.length && !REMOTE) void learnSkills(id, name.trim(), skills);
    } else app.setTab("graph");
  };

  const shown = AGENT_SUGGESTIONS.filter((s) => group === "All" || s.group === group);
  const picked = AGENT_SUGGESTIONS.find((s) => s.name === name);
  return (
    <>
      <div data-closing={presence.closing || undefined} className="palette-scrim" onClick={() => setOpen(false)} />
      <section className="palette hermes-sheet new-agent" role="dialog" aria-modal="true" data-closing={presence.closing || undefined} aria-label="New agent" data-testid="new-agent">
        <header className="na-head">
          <AgentFace seed={id} size={52} />
          <div className="na-id">
            <input autoFocus className="na-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name your agent" maxLength={60} data-testid="new-agent-name" aria-label="Name"
              onKeyDown={(e) => { if (e.key === "Enter") void create(); }} />
            <input className="na-about" value={about} onChange={(e) => setAbout(e.target.value)} placeholder="What should it do?" maxLength={200} data-testid="new-agent-about" aria-label="What it does"
              onKeyDown={(e) => { if (e.key === "Enter") void create(); }} />
          </div>
          <button className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}><X size={15} /></button>
        </header>
        <div className="na-body">
          <div className="na-filter" role="tablist" aria-label="Starting points">
            {(["All", ...AGENT_GROUPS] as const).map((g) => (
              <button key={g} role="tab" aria-selected={group === g} onClick={() => setGroup(g)}>{g}</button>
            ))}
          </div>
          <div className="na-cards" role="group" aria-label="Start from">
            {shown.map((s) => (
              <button key={s.name} className="na-card" aria-pressed={name === s.name} data-testid="new-agent-suggestion"
                onClick={() => { setName(s.name); setAbout(s.about); setSoul(s.soul); setSkills(s.skills ?? []); }}>
                <AgentFace seed={agentIdFor(s.name, new Set())} size={30} />
                <b>{s.name}</b>
                <small>{s.about}</small>
              </button>
            ))}
          </div>
        </div>
        <div className="na-setup">
          <label className="na-row"><span>Thinks with</span>
            <Picker label="Thinks with" value={model} onChange={setModel} testId="new-agent-model"
              options={models.length ? models.map((m) => ({ value: m.id, label: modelName(m.data.model) || m.data.label || m.data.name, sub: m.data.label || m.data.name, icon: <ModelMark model={m.data.model} baseUrl={m.data.baseUrl} size={16} /> }))
                : [{ value: "new-local", label: "A model on this computer" }, { value: "new-cloud", label: "A cloud model" }]} />
          </label>
          {skills.length > 0 && (
            <div className="na-row" data-testid="new-agent-skills"><span>Starts with</span>
              <div className="na-skills">
                {skills.map((k) => (
                  <span key={k} className="chip" data-tip={k}>{prettyName(skillName(k))}
                    <button className="chip-x" aria-label={`Leave out ${prettyName(skillName(k))}`} onClick={() => setSkills(skills.filter((x) => x !== k))}><X size={10} /></button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        <footer className="new-agent-foot">
          <button className="btn ghost sm" onClick={() => useApp.getState().setBuilder(true)} data-testid="new-agent-builder"><Logo size={14} /> Describe a team</button>
          <button className="btn ghost sm" onClick={() => useApp.getState().setTeamsOpen(true)} data-testid="new-agent-team">Ready-made teams</button>
          <span className="grow" />
          {picked && <span className="faint na-picked">Personality from {picked.name}</span>}
          <button className="btn primary" disabled={!name.trim() || busy} onClick={() => void create()} data-testid="new-agent-create">Create</button>
        </footer>
      </section>
    </>
  );
}

