import { FileText, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentMemoryView, MemoryFileView } from "../../contracts/api";
import { engine } from "../lib/engine";
import { layoutTree, type TreeIn } from "../lib/tree";
import { Sidebar } from "../shell/Sidebar";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { AgentFace, Empty } from "../ui";
import { GraphCanvas, type GEdge, type GNode } from "./GraphCanvas";

const FILE = { memory: "MEMORY.md", user: "USER.md" } as const;
const noteHeight = (text: string) => 24 + Math.max(1, Math.ceil(text.length / 38) + (text.match(/\n/g)?.length ?? 0)) * 19;

type Sel = { target: "memory" | "user"; index: number | null } | null;

function Editor({ agent, sel, onClose, onSaved }: { agent: AgentMemoryView; sel: NonNullable<Sel>; onClose: () => void; onSaved: (f: MemoryFileView) => void }) {
  const toast = useApp((s) => s.toast);
  const file = agent[sel.target];
  const [text, setText] = useState(sel.index === null ? "" : file.entries[sel.index] ?? "");
  const [busy, setBusy] = useState(false);
  const save = async (entries: string[]) => {
    setBusy(true);
    try {
      onSaved(await engine.saveMemory(agent.profile, sel.target, entries, file.sha256));
      onClose();
    } catch (err) {
      toast({ kind: "fail", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const next = sel.index === null ? [...file.entries, text] : file.entries.map((e, i) => (i === sel.index ? text : e));
  const used = [...next.map((e) => e.trim()).filter(Boolean).join("\n§\n")].length;
  return (
    <aside className="side-panel glass" data-testid="memory-editor">
      <div className="side-panel-head">
        <span className="tile sm file"><FileText size={13} /></span>
        <b className="grow">{sel.index === null ? `New in ${FILE[sel.target]}` : FILE[sel.target]}</b>
        <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={15} /></button>
      </div>
      <div className="side-panel-body stack" style={{ gap: 12 }}>
        <label className="field"><textarea rows={8} value={text} autoFocus onChange={(e) => setText(e.target.value)} aria-label="Memory entry" /></label>
        <div className="row">
          <span className={`num ${used > file.limit ? "" : "faint"}`} style={{ fontSize: 12, color: used > file.limit ? "var(--fail)" : undefined }}>{used} / {file.limit}</span>
          <span className="grow" />
          {sel.index !== null && <button className="btn danger" disabled={busy || agent.busy} onClick={() => save(file.entries.filter((_, i) => i !== sel.index))}><Trash2 size={13} /> Delete</button>}
          <button className="btn primary" disabled={busy || agent.busy || !text.trim() || used > file.limit} onClick={() => save(next)}>Save</button>
        </div>
      </div>
    </aside>
  );
}

export function MemoryView() {
  const { boardId } = useBoard();
  const runs = useApp((s) => s.runs);
  const setTab = useApp((s) => s.setTab);
  const [agents, setAgents] = useState<AgentMemoryView[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const finished = Object.values(runs).filter((r) => r.status !== "running").length;

  const load = useCallback(() => engine.memory(boardId).then(setAgents).catch(() => setAgents([])), [boardId]);
  useEffect(() => {
    void load();
  }, [load, finished]);

  const agent = agents?.find((a) => a.profile === current) ?? agents?.find((a) => a.compiled) ?? agents?.[0] ?? null;
  const { nodes, edges } = useMemo(() => {
    if (!agent) return { nodes: [] as GNode[], edges: [] as GEdge[] };
    const tree: TreeIn = {
      id: "agent", height: 64,
      children: (["memory", "user"] as const).map((t) => ({
        id: t, height: 54,
        children: agent[t].entries.map((e, i) => ({ id: `${t}:${i}`, height: noteHeight(e) })),
      })),
    };
    const pos = layoutTree(tree, { column: 320, row: 54, gap: 14 });
    const at = (id: string) => pos.get(id)!;
    const ns: GNode[] = [
      { id: "agent", ...at("agent"), className: "root", content: <><AgentFace seed={agent.profile} size={38} /><span><span className="label" style={{ display: "block" }}>{agent.displayName}</span><span className="sub">memories</span></span></> },
    ];
    const es: GEdge[] = [];
    for (const t of ["memory", "user"] as const) {
      const f = agent[t];
      const pct = Math.min(100, Math.round((f.chars / f.limit) * 100));
      ns.push({
        id: t, ...at(t), content: (
          <>
            <span className="tile sm agent"><FileText size={13} /></span>
            <span className="grow"><span className="label" style={{ display: "block" }}>{FILE[t]}</span><span className="sub num">{f.entries.length} · {pct}% full</span></span>
            <Plus size={14} className="faint" />
          </>
        ),
      });
      es.push({ id: `e-${t}`, source: "agent", target: t });
      f.entries.forEach((e, i) => {
        ns.push({ id: `${t}:${i}`, ...at(`${t}:${i}`), className: "note", content: e });
        es.push({ id: `e-${t}-${i}`, source: t, target: `${t}:${i}` });
      });
    }
    return { nodes: ns, edges: es };
  }, [agent]);

  const onSelect = (id: string | null) => {
    if (!id || id === "agent") return setSel(null);
    if (id === "memory" || id === "user") return setSel({ target: id, index: null });
    const [t, i] = id.split(":");
    setSel({ target: t as "memory" | "user", index: Number(i) });
  };

  if (agents && !agents.length) {
    return <section className="main flush-left"><Empty title="No agents yet" action={<button className="btn light" onClick={() => setTab("graph")}>Open graph</button>}>Agents show what they remember here.</Empty></section>;
  }

  return (
    <>
      <Sidebar title="Memory" action={<button className="icon-btn sm" aria-label="Reload" data-tip="Reload" data-tip-side="bottom" onClick={() => void load()}><RefreshCw size={13} /></button>}>
        {(agents ?? []).map((a) => (
          <button key={a.profile} className="list-row" aria-selected={agent?.profile === a.profile} onClick={() => { setCurrent(a.profile); setSel(null); }}>
            <AgentFace seed={a.profile} size={30} />
            <span className="grow" style={{ display: "grid" }}>
              <span className="title ellipsis">{a.displayName}</span>
              <span className="sub">{a.compiled ? (() => { const n = a.memory.entries.length + a.user.entries.length; return n === 0 ? "Nothing yet" : n === 1 ? "1 memory" : `${n} memories`; })() : "Not compiled"}</span>
            </span>
            {a.busy && <span className="dot run" />}
          </button>
        ))}
      </Sidebar>
      <section className="main" data-testid="memory-graph">
        {agent && !agent.compiled ? (
          <Empty title={`${agent.displayName} has no profile yet`}>Compile the board to create it.</Empty>
        ) : agent ? (
          <div className="view">
            <div className={`graph-area${sel ? " with-panel" : ""}`}><GraphCanvas key={agent.profile} nodes={nodes} edges={edges} selected={sel ? (sel.index === null ? sel.target : `${sel.target}:${sel.index}`) : null} onSelect={onSelect} fitSignature={`${agent.profile}:${nodes.length}:${!!sel}`} /></div>
            {sel && <Editor key={`${sel.target}:${sel.index}`} agent={agent} sel={sel} onClose={() => setSel(null)} onSaved={(f) => setAgents((prev) => prev?.map((a) => (a.profile === agent.profile ? { ...a, [f.target]: f } : a)) ?? prev)} />}
          </div>
        ) : <Empty title="Loading" />}
      </section>
    </>
  );
}

