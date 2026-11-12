/** Add a chat app: every platform Hermes' gateway ships, wired to the agent you have selected. */
import { MessagesSquare, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { addEdge, addNode } from "../../board/ydoc";
import { PLATFORMS, type AgentNode, type PlatformId } from "../../contracts/graph";
import { newChannel, newId } from "../graph/defaults";
import { freeSpot } from "../graph/place";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";

/** The ones most people use first; the rest follow alphabetically. */
const FIRST: PlatformId[] = ["telegram", "slack", "discord", "whatsapp_cloud", "teams", "email", "signal", "matrix"];

export function ChatAppCatalog() {
  const open = useApp((s) => s.chatAppsOpen);
  const setOpen = useApp((s) => s.setChatAppsOpen);
  const { doc, graph } = useBoard();
  const [q, setQ] = useState("");
  const agents = useMemo(() => graph.nodes.filter((n): n is AgentNode => n.kind === "agent"), [graph]);
  const selected = useApp((s) => s.selectedNodeId);
  const target = agents.find((a) => a.id === selected) ?? (agents.length === 1 ? agents[0] : undefined);

  useEffect(() => {
    if (!open) return;
    setQ("");
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  if (!open) return null;

  const add = (platform: PlatformId) => {
    const node = newChannel(graph, platform, freeSpot(graph, "channel", target?.position ?? null, target?.id ?? null));
    doc.transact(() => {
      addNode(doc, node);
      if (target) addEdge(doc, { id: newId("edge"), source: target.id, target: node.id, order: 0 });
    });
    setOpen(false);
    const app = useApp.getState();
    app.setTab("graph");
    app.select(node.id);
    app.toast({ kind: "ok", text: target ? `${PLATFORMS[platform].label} added to ${target.data.displayName || target.data.name}. Fill it in, then compile.` : `${PLATFORMS[platform].label} added. Wire it to an agent.` });
  };
  const words = q.trim().toLowerCase();
  const ids = (Object.keys(PLATFORMS) as PlatformId[])
    .filter((id) => !words || `${id} ${PLATFORMS[id].label}`.toLowerCase().includes(words))
    .sort((a, b) => {
      const fa = FIRST.indexOf(a), fb = FIRST.indexOf(b);
      if (fa >= 0 || fb >= 0) return (fa < 0 ? 99 : fa) - (fb < 0 ? 99 : fb);
      return PLATFORMS[a].label.localeCompare(PLATFORMS[b].label);
    });

  return (
    <>
      <div className="palette-scrim" onClick={() => setOpen(false)} />
      <section className="palette hermes-sheet catalog" role="dialog" aria-label="Add a chat app" data-testid="chat-catalog">
        <header>
          <span className="hermes-mark" aria-hidden><MessagesSquare size={18} /></span>
          <div className="grow">
            <h2>Add a chat app</h2>
            <small>{target ? `For ${target.data.displayName || target.data.name}` : "Select an agent first to wire it straight in"}</small>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}><X size={15} /></button>
        </header>
        <label className="catalog-search"><Search size={14} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chat apps" aria-label="Search chat apps" /></label>
        <div className="catalog-body">
          <div className="catalog-grid">
            {ids.map((id) => {
              const p = PLATFORMS[id];
              const needs = p.required.map((f) => f.prompt).join(" · ");
              return (
                <button key={id} className="catalog-card" onClick={() => add(id)} data-testid={`chat-${id}`}>
                  <span className="tile sm channel">{p.label.slice(0, 1)}</span>
                  <span className="grow" style={{ display: "grid", gap: 2, minWidth: 0 }}>
                    <b>{p.label}</b>
                    <span className="faint ellipsis" data-tip={needs}>{needs}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
