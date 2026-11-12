/** Starter teams: pick one and its agents, instructions and hand-offs join the board. */
import { Users, X } from "lucide-react";
import { useEffect } from "react";
import { addEdge, addNode } from "../../board/ydoc";
import type { ModelNode } from "../../contracts/graph";
import { compileBoard } from "../actions";
import { newModel } from "../graph/defaults";
import { TEAMS, teamToAdd, type StarterTeam } from "../graph/teams";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { AgentFace } from "../ui";

export function TeamsSheet() {
  const open = useApp((s) => s.teamsOpen);
  const setOpen = useApp((s) => s.setTeamsOpen);
  const { doc, graph, boardId } = useBoard();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  if (!open) return null;

  const add = async (team: StarterTeam) => {
    // The board's primary local model if it has one, else its first model, else a new local one.
    const models = graph.nodes.filter((n): n is ModelNode => n.kind === "model");
    const model = models.find((m) => m.data.endpoint === "local") ?? models[0] ?? null;
    const { nodes, edges, lead } = teamToAdd(graph, team, model, (p) => newModel(graph, "local", p));
    doc.transact(() => {
      for (const n of nodes) addNode(doc, n);
      for (const e of edges) addEdge(doc, e);
    });
    setOpen(false);
    const app = useApp.getState();
    app.setTab("graph");
    app.select(lead);
    app.toast({ kind: "ok", text: `${team.label} joined the board` });
    await compileBoard(boardId, { quiet: true });
  };

  return (
    <>
      <div className="palette-scrim" onClick={() => setOpen(false)} />
      <section className="palette hermes-sheet catalog" role="dialog" aria-label="Add a team" data-testid="teams-sheet">
        <header>
          <span className="hermes-mark" aria-hidden><Users size={18} /></span>
          <div className="grow">
            <h2>Start with a team</h2>
            <small>Agents, what each does, and who hands work to whom</small>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}><X size={15} /></button>
        </header>
        <div className="catalog-body teams-grid">
          {TEAMS.map((t) => (
            <button key={t.id} className="team-card" onClick={() => void add(t)} data-testid={`team-${t.id}`}>
              <span className="team-faces">{t.members.map((m) => <AgentFace key={m.name} seed={m.name} size={34} />)}</span>
              <b>{t.label}</b>
              <span className="faint">{t.does}</span>
              <span className="team-members">{t.members.map((m) => m.displayName).join(" · ")}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
