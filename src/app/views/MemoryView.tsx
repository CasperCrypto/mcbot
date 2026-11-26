import { FileText, Hammer, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { compileBoard } from "../actions";
import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import type { AgentNode } from "../../contracts/graph";
import { hasFiles } from "../files/drop";
import { shownAs } from "../files/paths";
import { addDocuments } from "../lib/documents";
import { AskBar } from "../shell/AskBar";
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
          <span className={`num ${used > file.limit ? "" : "faint"}`} style={{ fontSize: 13, color: used > file.limit ? "var(--fail)" : undefined }}>{used} / {file.limit}</span>
          <span className="grow" />
          {sel.index !== null && <button className="btn danger" disabled={busy || agent.busy} onClick={() => save(file.entries.filter((_, i) => i !== sel.index))}><Trash2 size={13} /> Delete</button>}
          <button className="btn primary" disabled={busy || agent.busy || !text.trim() || used > file.limit} onClick={() => save(next)}>Save</button>
        </div>
      </div>
    </aside>
  );
}

/** Hermes keeps memory as entries between "§" lines; a dropped text that has them is several entries. */
export const entriesOf = (text: string): string[] => text.replace(/\r\n?/g, "\n").split(/\n§\n/).map((e) => e.trim()).filter(Boolean);
/** Characters the entries take in Hermes' file (they are joined with "\n§\n"). */
export const memoryChars = (entries: readonly string[]): number => entries.map((e) => e.trim()).filter(Boolean).join("\n§\n").length;

export function MemoryView() {
  const { boardId, graph, doc } = useBoard();
  const toast = useApp((s) => s.toast);
  const runs = useApp((s) => s.runs);
  const setTab = useApp((s) => s.setTab);
  const [agents, setAgents] = useState<AgentMemoryView[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [dropping, setDropping] = useState(false);
  const [hot, setHot] = useState<"memory" | "user" | null>(null);
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

  /**
   * Text files dropped on MEMORY.md or USER.md become entries while they fit (Hermes' limit); a file
   * too big for memory, or one that isn't text (a PDF…), becomes a document every agent reads when
   * it needs it.
   */
  const addFiles = async (target: "memory" | "user", files: File[]) => {
    if (!agent) return;
    if (agent.busy) return toast({ kind: "fail", text: `${agent.displayName} is working. Add it when the run ends.` });
    const f = agent[target];
    let entries = [...f.entries];
    const added: string[] = [];
    const toDocs: File[] = [];
    for (const file of files) {
      const text = shownAs(file.name) === "text" && file.size < 200_000 ? await file.text() : null;
      const more = text === null || text.includes("\u0000") ? null : entriesOf(text);
      if (!more?.length || memoryChars([...entries, ...more]) > f.limit) {
        if (more?.length !== 0) toDocs.push(file);
        continue;
      }
      entries = [...entries, ...more];
      added.push(file.name);
    }
    if (added.length) {
      try {
        const saved = await engine.saveMemory(agent.profile, target, entries, f.sha256);
        setAgents((prev) => prev?.map((a) => (a.profile === agent.profile ? { ...a, [saved.target]: saved } : a)) ?? prev);
        toast({ kind: "ok", text: `${added.length === 1 ? added[0] : `${added.length} files`} added to ${FILE[target]}` });
      } catch (err) {
        toast({ kind: "fail", text: (err as Error).message });
      }
    }
    if (toDocs.length) {
      const docs = await addDocuments(doc, boardId, toDocs);
      if (docs.length) toast({ kind: "info", text: `${docs.length === 1 ? docs[0] : `${docs.length} files`} ${docs.length === 1 ? "is" : "are"} too big for memory: added to Documents, which every agent reads when it needs them`, action: { label: "Open", run: () => setTab("knowledge") } });
    }
  };
  const dragOn = (e: DragEvent) => {
    if (!hasFiles(e.dataTransfer) || !agent?.compiled) return;
    e.preventDefault();
    setDropping(true);
  };
  const dropOn = (target: "memory" | "user") => ({
    onDragOver: (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; setHot(target); },
    onDragLeave: () => setHot(null),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropping(false);
      setHot(null);
      void addFiles(target, [...e.dataTransfer.files]);
    },
  });
  const nodeId = agent ? graph.nodes.find((n): n is AgentNode => n.kind === "agent" && n.data.name === agent.profile)?.id : undefined;

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
      <section className="main memory-main" data-testid="memory-graph" onDragOver={dragOn} onDrop={(e) => { e.preventDefault(); setDropping(false); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setDropping(false); setHot(null); } }}>
        {dropping && agent && (
          <div className="memory-drop" data-testid="memory-drop">
            {(["memory", "user"] as const).map((t) => (
              <div key={t} className={`memory-drop-zone${hot === t ? " hot" : ""}`} {...dropOn(t)}>
                <FileText size={22} />
                <b>{FILE[t]}</b>
                <span>{t === "memory" ? `What ${agent.displayName} notes for itself` : `What ${agent.displayName} knows about you`}</span>
                <small className="faint">{Math.max(0, agent[t].limit - agent[t].chars)} characters free · bigger files become documents</small>
              </div>
            ))}
          </div>
        )}
        {agent && !agent.compiled ? (
          <Empty title={`${agent.displayName} has no memory yet`} action={
            <button className="btn primary" onClick={() => void compileBoard(boardId).then((ok) => { if (ok) void load(); })}><Hammer size={13} /> Compile to create it</button>
          }>Memory starts once the agent is compiled. Then it remembers by itself, and you can add notes here.</Empty>
        ) : agent ? (
          <div className="view">
            <div className={`graph-area${sel ? " with-panel" : ""}`}><GraphCanvas key={agent.profile} nodes={nodes} edges={edges} selected={sel ? (sel.index === null ? sel.target : `${sel.target}:${sel.index}`) : null} onSelect={onSelect} fitSignature={`${agent.profile}:${nodes.length}:${!!sel}`} /></div>
            {sel && <Editor key={`${sel.target}:${sel.index}`} agent={agent} sel={sel} onClose={() => setSel(null)} onSaved={(f) => setAgents((prev) => prev?.map((a) => (a.profile === agent.profile ? { ...a, [f.target]: f } : a)) ?? prev)} />}
          </div>
        ) : <Empty title="Loading" />}
        {agent?.compiled && (
          <AskBar className="memory-ask" testId="memory-ask" prefer={nodeId}
            placeholder={`Ask ${agent.displayName} to remember, forget or tidy something…`}
            about={() => "(This is about your memory: MEMORY.md and USER.md. Change it with your memory tool.)"} />
        )}
      </section>
    </>
  );
}

