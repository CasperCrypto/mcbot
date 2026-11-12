import { MessagesSquare } from "lucide-react";
import { useState } from "react";
import { TeamChat } from "../shell/TeamPanel";
import { PEER_COLORS } from "../lib/identity";
import { VIEWS } from "../shell/Palette";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { PersonFace } from "../ui";

export function TeamView() {
  const { peers, graph } = useBoard();
  const identity = useApp((s) => s.identity);
  const setIdentity = useApp((s) => s.setIdentity);
  const tab = useApp((s) => s.tab);
  const selected = useApp((s) => s.selectedNodeId);
  const [name, setName] = useState(identity.name);

  const where = (t: string | null, sel: string | null) => {
    const view = VIEWS.find((v) => v.tab === t)?.label ?? "—";
    const n = graph.nodes.find((x) => x.id === sel);
    const node = n ? (n.kind === "agent" ? n.data.displayName : n.data.label) || n.data.name : null;
    return node ? `${view} · ${node}` : view;
  };
  const commit = () => name.trim() && setIdentity({ ...identity, name: name.trim() });

  return (
    <section className="main flush-left">
      <div className="team-page page-enter">
        <div className="team-people-col">
        <h2 className="team-page-title">People</h2>
        <div className="people" data-testid="team">
          <div className="card person">
            <PersonFace name={identity.name} color={identity.color} size={64} />
            <input className="name-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} aria-label="Your name" data-testid="identity-name" />
            <div className="swatches">
              {PEER_COLORS.map((c) => <button key={c} className="swatch" style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={c === identity.color} onClick={() => setIdentity({ ...identity, color: c })} />)}
            </div>
            <span className="where">You · {where(tab, selected)}</span>
          </div>
          {peers.map((p) => (
            <div key={p.clientId} className="card person">
              <PersonFace name={p.name} color={p.color} size={64} />
              <span className="name">{p.name}</span>
              <span className="where">{where(p.tab, p.selection)}</span>
            </div>
          ))}
        </div>
        </div>
        <div className="card team-chat-col">
          <div className="team-page-head"><MessagesSquare size={14} className="faint" /><b>Team chat</b><span className="faint">· @agent asks an agent</span></div>
          <TeamChat />
        </div>
      </div>
    </section>
  );
}
