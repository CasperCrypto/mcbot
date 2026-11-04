import { Users } from "lucide-react";
import { useState } from "react";
import { initials, PEER_COLORS } from "../lib/identity";
import { useBoard } from "../state/board";
import { useApp, type Tab } from "../state/store";

const TAB_LABEL: Record<Tab, string> = { graph: "Graph", agents: "Agents", workflows: "Workflows", memory: "Memory", files: "Files", cost: "Cost", team: "Team" };

export function TeamTab() {
  const { peers, graph, synced } = useBoard();
  const identity = useApp((s) => s.identity);
  const setIdentity = useApp((s) => s.setIdentity);
  const tab = useApp((s) => s.tab);
  const selected = useApp((s) => s.selectedNodeId);
  const [name, setName] = useState(identity.name);

  const nodeName = (id: string | null) => {
    const n = graph.nodes.find((x) => x.id === id);
    return n ? `${n.kind} “${(n.kind === "agent" ? n.data.displayName : n.data.label) || n.data.name}”` : null;
  };
  const everyone = [{ clientId: -1, name: identity.name, color: identity.color, tab, selection: selected, you: true }, ...peers.map((p) => ({ ...p, you: false }))];

  return (
    <div className="page page-narrow">
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><h3>You</h3><span className="faint">Shown to everyone on this board. No accounts in v0 — this is per device.</span></div>
        <div className="card-body row" style={{ gap: 16, flexWrap: "wrap" }}>
          <div className="avatar" style={{ background: identity.color, width: 34, height: 34, fontSize: 13 }}>{initials(identity.name)}</div>
          <label className="field" style={{ width: 220 }}>
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && setIdentity({ ...identity, name: name.trim() })}
              onKeyDown={(e) => e.key === "Enter" && name.trim() && setIdentity({ ...identity, name: name.trim() })} data-testid="identity-name" />
          </label>
          <div className="field"><span>Color</span>
            <div className="swatches">{PEER_COLORS.map((c) => <button key={c} className="swatch" style={{ background: c }} aria-label={`Color ${c}`} aria-pressed={c === identity.color} onClick={() => setIdentity({ ...identity, color: c })} />)}</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <div className="card-head"><Users size={15} className="faint" /><h3>On this board</h3><span className="faint">{everyone.length} {everyone.length === 1 ? "person" : "people"} · {synced ? "live" : "connecting…"}</span></div>
        <table className="table" data-testid="team-table">
          <thead><tr><th>Who</th><th>Looking at</th><th>Editing</th></tr></thead>
          <tbody>
            {everyone.map((p) => (
              <tr key={p.clientId}>
                <td><div className="row"><div className="avatar" style={{ background: p.color }}>{initials(p.name)}</div><b>{p.name}</b>{p.you && <span className="badge">you</span>}</div></td>
                <td>{p.tab ? TAB_LABEL[p.tab] : <span className="faint">—</span>}</td>
                <td>{nodeName(p.selection) ?? <span className="faint">nothing selected</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="faint" style={{ marginTop: 14 }}>Open a second McBot window (⌘N in the desktop app, or another tab on the dev server) to work on this board together. Everyone connects to this computer's engine; changes merge live — no save button.</p>
    </div>
  );
}
