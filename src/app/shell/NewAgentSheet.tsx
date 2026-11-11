/** Make an agent: a name, what it does, how it works, and the model it thinks with. */
import { Cloud, HardDrive, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { addEdge, addNode } from "../../board/ydoc";
import { RESERVED_PROFILE_NAMES, type GraphNode, type ModelNode } from "../../contracts/graph";
import { compileBoard } from "../actions";
import { newAgent, newId, newModel } from "../graph/defaults";
import { freeSpot } from "../graph/place";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { AgentFace } from "../ui";

/** "Launch Writer" → "launch-writer": Hermes' profile id grammar, unique on the board. */
export function agentIdFor(name: string, taken: ReadonlySet<string>): string {
  const base = name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "agent";
  const ok = (id: string) => !taken.has(id) && !(RESERVED_PROFILE_NAMES as readonly string[]).includes(id);
  if (ok(base)) return base;
  for (let i = 2; ; i++) if (ok(`${base}-${i}`)) return `${base}-${i}`;
}

export function NewAgentSheet() {
  const open = useApp((s) => s.newAgentOpen);
  const setOpen = useApp((s) => s.setNewAgentOpen);
  const { doc, graph, boardId } = useBoard();
  const models = useMemo(() => graph.nodes.filter((n): n is ModelNode => n.kind === "model"), [graph]);
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [soul, setSoul] = useState("");
  const [model, setModel] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setAbout("");
    setSoul("");
    setModel(models[0]?.id ?? "new-local");
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;
  const taken = new Set(graph.nodes.filter((n) => n.kind === "agent").map((n) => String(n.data.name)));
  const id = agentIdFor(name, taken);

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const app = useApp.getState();
    const base = newAgent(graph, freeSpot(graph, "agent", null, null)) as Extract<GraphNode, { kind: "agent" }>;
    const agent: GraphNode = { ...base, data: { ...base.data, name: id, displayName: name.trim(), description: about.trim(), soul: soul.trim() ? soul : "" } };
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
    if (await compileBoard(boardId, { quiet: true })) app.openChat(agent.id);
    else app.setTab("graph");
  };

  return (
    <>
      <div className="palette-scrim" onClick={() => setOpen(false)} />
      <section className="palette hermes-sheet new-agent" role="dialog" aria-label="New agent" data-testid="new-agent">
        <header>
          <AgentFace seed={id} size={44} />
          <div className="grow">
            <h2>{name.trim() || "New agent"}</h2>
            <small className="mono">@{id}</small>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}><X size={15} /></button>
        </header>
        <div className="new-agent-body">
          <label className="field"><span>Name</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Writer" maxLength={60} data-testid="new-agent-name"
              onKeyDown={(e) => { if (e.key === "Enter") void create(); }} />
          </label>
          <label className="field"><span>What it does</span>
            <input value={about} onChange={(e) => setAbout(e.target.value)} placeholder="Writes our launch posts and newsletters" maxLength={200} data-testid="new-agent-about" />
          </label>
          <label className="field"><span>How it works <i className="faint">(optional)</i></span>
            <textarea rows={4} value={soul} onChange={(e) => setSoul(e.target.value)} placeholder={"Friendly and short. Always ask before publishing.\nSign posts as the McBot team."} />
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
          <span className="faint grow">Tools and abilities: on the graph, any time.</span>
          <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn primary" disabled={!name.trim() || busy} onClick={() => void create()} data-testid="new-agent-create">Create agent</button>
        </footer>
      </section>
    </>
  );
}
