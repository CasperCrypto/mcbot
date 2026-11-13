/** Add a ready-made tool: one click, wired to the agent you have selected (or your only agent). */
import { KeyRound, LogIn, Plug, Search, Server, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { addEdge, addNode } from "../../board/ydoc";
import type { AgentNode } from "../../contracts/graph";
import { CATALOG, CONNECTOR_TOOLS, catalogNode, type CatalogTool } from "../graph/catalog";
import { newId, newTool } from "../graph/defaults";
import { LogoTile, logoFor } from "../graph/Logo";
import { freeSpot } from "../graph/place";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";

export function ToolCatalog() {
  const open = useApp((s) => s.catalogOpen);
  const setOpen = useApp((s) => s.setCatalogOpen);
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

  const taken = new Set(graph.nodes.filter((n) => n.kind === "tool").map((n) => String(n.data.name)));
  const place = (make: (pos: { x: number; y: number }) => ReturnType<typeof catalogNode>) => {
    const node = make(freeSpot(graph, "tool", target?.position ?? null, target?.id ?? null));
    doc.transact(() => {
      addNode(doc, node);
      if (target) addEdge(doc, { id: newId("edge"), source: target.id, target: node.id, order: 0 });
    });
    setOpen(false);
    const app = useApp.getState();
    app.setTab("graph");
    app.select(node.id);
    app.toast({ kind: "ok", text: target ? `${node.kind === "tool" ? node.data.label || node.data.name : "Tool"} added to ${target.data.displayName || target.data.name}. Compile to use it.` : "Tool added. Wire it to an agent." });
  };
  const add = (t: CatalogTool) => place((p) => catalogNode(t, taken, p));
  const words = q.trim().toLowerCase();
  const list = [...CATALOG, ...CONNECTOR_TOOLS].filter((t) => !words || `${t.label} ${t.does} ${t.group}`.toLowerCase().includes(words));
  const groups = [...new Set(list.map((t) => t.group))];

  return (
    <>
      <div className="palette-scrim" onClick={() => setOpen(false)} />
      <section className="palette hermes-sheet catalog" role="dialog" aria-label="Add a tool" data-testid="tool-catalog">
        <header>
          <span className="hermes-mark" aria-hidden><Plug size={18} /></span>
          <div className="grow">
            <h2>Add a tool</h2>
            <small>{target ? `For ${target.data.displayName || target.data.name}` : "Select an agent first to wire it straight in"}</small>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}><X size={15} /></button>
        </header>
        <label className="catalog-search"><Search size={14} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tools" aria-label="Search tools" /></label>
        <div className="catalog-body">
          {groups.map((g) => (
            <div key={g} className="stack" style={{ gap: 8 }}>
              <span className="section-label">{g}</span>
              <div className="catalog-grid">
                {list.filter((t) => t.group === g).map((t) => (
                  <button key={t.id} className="catalog-card" onClick={() => add(t)} data-testid={`catalog-${t.id}`}>
                    <LogoTile sm logo={logoFor([t.name, t.id], t.url)} kind="tool">{t.label.slice(0, 1)}</LogoTile>
                    <span className="grow" style={{ display: "grid", gap: 2 }}>
                      <b>{t.label}</b>
                      <span className="faint">{t.does}</span>
                    </span>
                    {t.oauth && <span className="faint" data-tip="Sign in with your account after adding it"><LogIn size={13} /></span>}
                    {t.key && <span className="faint" data-tip={`${t.key.optional ? "Optional key" : "Needs a key"} from ${t.key.where}`}><KeyRound size={13} /></span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="stack" style={{ gap: 8 }}>
            <span className="section-label">Your own</span>
            <div className="catalog-grid">
              <button className="catalog-card" onClick={() => place((p) => newTool(graph, "stdio", p, null) as ReturnType<typeof catalogNode>)} data-testid="catalog-custom">
                <span className="tile sm tool"><Server size={14} /></span>
                <span className="grow" style={{ display: "grid", gap: 2 }}><b>Any MCP server</b><span className="faint">A command, or a remote URL</span></span>
              </button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
