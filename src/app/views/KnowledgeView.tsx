/**
 * Knowledge: everything the agents know, in one place. Business (the team knowledge every SOUL.md
 * carries, and documents every agent reads as its business-files skill), Memory (what each agent
 * remembers), Skills (what each can do: Hermes' skills and plugins) and Training (its answers as data
 * to train a model of your own). The old tabs (memory, skills, learn) are its segments, so every link
 * to them lands here. Export writes it all as one Markdown file.
 */
import { Download, FileText, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { removeDoc } from "../../board/ydoc";
import type { Doc } from "../../contracts/graph";
import { knowledgeMarkdown } from "../../harness/knowledgeMd";
import { compileBoard } from "../actions";
import { hasFiles } from "../files/drop";
import { addDocuments } from "../lib/documents";
import { engine, REMOTE } from "../lib/engine";
import { ago } from "../lib/format";
import { AskBar } from "../shell/AskBar";
import { BriefFields } from "../shell/KnowledgeSheet";
import { HIDDEN_FOR_GUESTS } from "../shell/Rail";
import { useBoard } from "../state/board";
import { useApp, type Tab } from "../state/store";
import { Segmented } from "../ui";
import { LearnView } from "./LearnView";
import { MemoryView } from "./MemoryView";
import { SkillsView } from "./SkillsView";

const SEGMENTS: { value: Tab; label: string }[] = [
  { value: "knowledge", label: "Business" },
  { value: "memory", label: "Memory" },
  { value: "skills", label: "Skills" },
  { value: "learn", label: "Training" },
];
/** The tabs this view shows. */
export const KNOWLEDGE_TABS: readonly Tab[] = SEGMENTS.map((s) => s.value);

const size = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`);

export function KnowledgeView() {
  const tab = useApp((s) => s.tab);
  const setTab = useApp((s) => s.setTab);
  const segments = SEGMENTS.filter((s) => !REMOTE || !HIDDEN_FOR_GUESTS.has(s.value));
  const current = KNOWLEDGE_TABS.includes(tab) ? tab : "knowledge";
  return (
    <div className="knowledge-shell" data-testid="knowledge-view">
      <div className="knowledge-bar">
        <div className="knowledge-seg"><Segmented value={current} options={segments} onChange={setTab} /></div>
        <span className="grow" />
        <ExportButton />
      </div>
      <div className="knowledge-content">
        {current === "memory" ? <MemoryView /> : current === "skills" ? <SkillsView /> : current === "learn" ? <LearnView /> : <Business />}
      </div>
    </div>
  );
}

function ExportButton() {
  const { graph, boardId } = useBoard();
  const toast = useApp((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const memory = await engine.memory(boardId).catch(() => []);
      const md = knowledgeMarkdown(graph, memory, new Date().toISOString().slice(0, 10));
      const { path } = await engine.exportKnowledge(boardId, md);
      toast({ kind: "ok", text: `Saved ${path.split(/[\\/]/).pop()}` });
    } catch (err) {
      toast({ kind: "fail", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  if (REMOTE) return null;
  return <button className="btn sm" disabled={busy} onClick={() => void save()} data-tip="Everything the agents know, as one Markdown file (in McBot's exports folder)" data-tip-side="bottom" data-testid="knowledge-export"><Download size={13} /> Export .md</button>;
}

function Business() {
  const { graph, doc, boardId } = useBoard();
  const docs = [...(graph.docs ?? [])].sort((a, b) => b.at - a.at);
  const [adding, setAdding] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // The agents get new knowledge with their next compile: do it once when leaving, quietly, if anything changed.
  const brief = JSON.stringify(graph.brief ?? null);
  const first = useRef(brief);
  const latest = useRef({ brief, boardId });
  latest.current = { brief, boardId };
  useEffect(() => () => {
    if (first.current !== latest.current.brief) void compileBoard(latest.current.boardId, { quiet: true });
  }, []);

  const add = (files: FileList | File[]) => addDocuments(doc, boardId, [...files], (name, on) => setAdding((a) => (on ? [...a, name] : a.filter((n) => n !== name))));
  const remove = (d: Doc) => {
    if (picked === d.id) setPicked(null);
    removeDoc(doc, d.id);
    void compileBoard(boardId, { quiet: true });
  };
  // Files dropped anywhere on Business become documents.
  const over_ = (e: DragEvent) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setOver(true);
  };
  const drop = (e: DragEvent) => {
    setOver(false);
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    if (e.dataTransfer.files.length) void add(e.dataTransfer.files);
  };
  const chosen = docs.find((d) => d.id === picked) ?? null;

  return (
    <section className="main knowledge-business" data-testid="knowledge-business" onDragOver={over_} onDrop={drop}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}>
      <div className="knowledge-cols">
        <div className="knowledge-col">
          <h2 className="knowledge-h" data-tip="Every agent knows this: it is in each one's SOUL.md">What they know</h2>
          <div className="knowledge-form"><BriefFields testPrefix="kb" /></div>
        </div>
        <div className="knowledge-col">
          <h2 className="knowledge-h" data-tip="Every agent can read these when a question needs them (its business-files skill)">Documents</h2>
          <div className={`doc-drop${over ? " over" : ""}`}
            onClick={() => input.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") input.current?.click(); }} data-testid="doc-drop">
            <Upload size={18} />
            <b>Add documents</b>
            <small className="faint">PDF, Word, Excel, PowerPoint, text, Markdown, CSV</small>
            <input ref={input} type="file" multiple hidden onChange={(e) => { if (e.target.files?.length) void add(e.target.files); e.target.value = ""; }} data-testid="doc-input" />
          </div>
          {adding.map((n) => <div key={`adding-${n}`} className="doc-row skeleton"><FileText size={15} /><span className="grow ellipsis">{n}</span><span className="faint">Reading…</span></div>)}
          {docs.map((d) => (
            <div key={d.id} className="doc-row" aria-selected={picked === d.id} data-testid="doc-row" role="button" tabIndex={0}
              onClick={() => setPicked(picked === d.id ? null : d.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPicked(picked === d.id ? null : d.id); } }}
              data-tip={picked === d.id ? undefined : "Select it to ask an agent about it"} data-tip-side="top">
              <FileText size={15} className="faint" />
              <span className="grow doc-name">
                <b className="ellipsis">{d.name}</b>
                <small className="faint ellipsis">{size(d.bytes)}{d.text.trim() ? "" : " · no text found"}{d.by ? ` · ${d.by}` : ""}{d.at ? ` · ${ago(d.at)}` : ""}</small>
              </span>
              <button className="icon-btn sm" aria-label={`Remove ${d.name}`} data-tip="Remove" onClick={(e) => { e.stopPropagation(); remove(d); }} data-testid="doc-remove"><Trash2 size={14} /></button>
            </div>
          ))}
          {docs.length === 0 && adding.length === 0 && <p className="faint knowledge-empty">Plans, price lists, policies: every agent reads them when a question needs them.</p>}
        </div>
      </div>
      <AskBar className="knowledge-ask" testId="knowledge-ask"
        placeholder={chosen ? `Ask about ${chosen.name}: summarize it, find…, draft a reply from it` : "Ask about your business: write a policy, check a price, draft an offer…"}
        about={() => (chosen ? `Document: ${chosen.name}\n\n${chosen.text.slice(0, 40_000)}` : "(What you know about the business is in your instructions, and its documents in your business-files skill.)")} />
    </section>
  );
}
