/** Make an agent: a name, what it does, how it works, and the model it thinks with. */
import { Cloud, HardDrive, X } from "lucide-react";
import { withRichAnswers } from "../chat/rich";
import { useEffect, useMemo, useState } from "react";
import { addEdge, addNode } from "../../board/ydoc";
import { RESERVED_PROFILE_NAMES, type GraphNode, type ModelNode } from "../../contracts/graph";
import { compileBoard, learnSkills, skillName } from "../actions";
import { newAgent, newId, newModel } from "../graph/defaults";
import { freeSpot } from "../graph/place";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { AgentFace } from "../ui";
import { usePresence } from "../lib/presence";
import { AGENT_GROUPS, AGENT_SUGGESTIONS, agentIdFor } from "./agentSuggestions";
import { REMOTE } from "../lib/engine";

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
    });
    setOpen(false);
    setBusy(false);
    app.select(agent.id);
    // Ready to talk to straight away when the board compiles; otherwise the graph shows what is missing.
    if (await compileBoard(boardId, { quiet: true })) {
      app.openChat(agent.id);
      if (skills.length && !REMOTE) void learnSkills(id, name.trim(), skills);
    } else app.setTab("graph");
  };

  return (
    <>
      <div data-closing={presence.closing || undefined} className="palette-scrim" onClick={() => setOpen(false)} />
      <section className="palette hermes-sheet new-agent" role="dialog" aria-modal="true" data-closing={presence.closing || undefined} aria-label="New agent" data-testid="new-agent">
        <header>
          <AgentFace seed={id} size={44} />
          <div className="grow">
            <h2>{name.trim() || "New agent"}</h2>
            <small className="mono">@{id}</small>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}><X size={15} /></button>
        </header>
        <div className="new-agent-body">
          <div className="suggest-groups" role="group" aria-label="Suggestions">
            {AGENT_GROUPS.map((g) => (
              <div key={g} className="suggest-group">
                <span className="suggest-label">{g}</span>
                <div className="suggest-row">
                  {AGENT_SUGGESTIONS.filter((s) => s.group === g).map((s) => (
                    <button key={s.name} className="suggest-card" aria-pressed={name === s.name} data-testid="new-agent-suggestion"
                      data-tip={s.skills?.length ? `${s.about} · Hermes skills: ${s.skills.map(skillName).join(", ")}` : s.about}
                      onClick={() => { setName(s.name); setAbout(s.about); setSoul(s.soul); setSkills(s.skills ?? []); }}>
                      <AgentFace seed={agentIdFor(s.name, new Set())} size={26} />
                      <span className="ellipsis">{s.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {skills.length > 0 && (
            <div className="field" data-testid="new-agent-skills"><span>Starts with Hermes skills</span>
              <div className="suggest-row">
                {skills.map((k) => (
                  <span key={k} className="chip">{skillName(k)}
                    <button className="chip-x" aria-label={`Leave out ${skillName(k)}`} onClick={() => setSkills(skills.filter((x) => x !== k))}><X size={10} /></button>
                  </span>
                ))}
              </div>
            </div>
          )}
          <label className="field"><span>Name</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Writer" maxLength={60} data-testid="new-agent-name"
              onKeyDown={(e) => { if (e.key === "Enter") void create(); }} />
          </label>
          <label className="field"><span>What it does</span>
            <input value={about} onChange={(e) => setAbout(e.target.value)} placeholder="Writes our launch posts and newsletters" maxLength={200} data-testid="new-agent-about" />
          </label>
          <label className="field"><span>How it works <i className="faint">(optional)</i></span>
            <textarea rows={3} value={soul} onChange={(e) => setSoul(e.target.value)} placeholder={"Friendly and short. Always ask before publishing.\nSign posts as the McBot team."} />
          </label>
          <div className="field"><span>Thinks with</span>
            <div className="assignees">
              {models.map((m) => (
                <button key={m.id} className="assignee" aria-pressed={model === m.id} onClick={() => setModel(m.id)}>
                  {m.data.endpoint === "local" ? <HardDrive size={15} /> : <Cloud size={15} />}
                  <span className="ellipsis">{m.data.label || m.data.name} · <span className="mono faint">{m.data.model}</span></span>
                </button>
              ))}
              {models.length === 0 && (
                <>
                  <button className="assignee" aria-pressed={model === "new-local"} onClick={() => setModel("new-local")}><HardDrive size={15} /><span>A local model</span></button>
                  <button className="assignee" aria-pressed={model === "new-cloud"} onClick={() => setModel("new-cloud")}><Cloud size={15} /><span>A cloud model</span></button>
                </>
              )}
            </div>
          </div>
        </div>
        <footer className="new-agent-foot">
          <button className="btn ghost sm" onClick={() => useApp.getState().setTeamsOpen(true)} data-testid="new-agent-team">Or start with a team</button>
          <button className="btn ghost sm" onClick={() => useApp.getState().setBuilder(true)} data-testid="new-agent-builder">Describe it to McBot</button>
          <span className="grow" />
          <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn primary" disabled={!name.trim() || busy} onClick={() => void create()} data-testid="new-agent-create">Create agent</button>
        </footer>
      </section>
    </>
  );
}

