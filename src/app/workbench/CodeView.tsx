import { ChevronDown, ChevronRight, File, FileLock, Folder, FolderPlus, Globe, PanelBottom, Save, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FsEntry, FsRoot } from "../../contracts/api";
import type { AgentNode } from "../../contracts/graph";
import { runAgent } from "../actions";
import { openBrowser } from "../lib/desktop";
import { engine } from "../lib/engine";
import { Sidebar, SidebarGroup } from "../shell/Sidebar";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { AgentFace, Empty, Kbd } from "../ui";
import { languageOf, monaco } from "./monaco";
import { TerminalPanel } from "./TerminalPanel";

interface Doc {
  key: string;
  root: FsRoot;
  path: string;
  /** What is on disk as the editor last read or saved it. */
  saved: string;
  sha256: string | null;
  readOnly: boolean;
  model: monaco.editor.ITextModel;
}

/** What the editor may change: compiled agent files come from the board, so only workspace/ is editable there. */
const editable = (root: FsRoot, path: string) => root.kind !== "profile" || path.startsWith("workspace/");
const sep = (p: string) => (p.includes("\\") ? "\\" : "/");

function Tree({ root, path, depth, open, toggle, listings, onFile, current }: {
  root: FsRoot; path: string; depth: number; open: Set<string>; toggle: (k: string) => void;
  listings: Record<string, FsEntry[]>; onFile: (root: FsRoot, path: string) => void; current: string | null;
}) {
  const entries = listings[`${root.id}:${path}`];
  if (!entries) return <div className="tree-row faint" style={{ paddingLeft: 12 + depth * 14 }}>…</div>;
  return (
    <>
      {entries.map((e) => {
        const key = `${root.id}:${e.path}`;
        const isOpen = open.has(key);
        return (
          <div key={key}>
            <button className="tree-row" aria-selected={current === key} style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() => (e.kind === "dir" ? toggle(key) : onFile(root, e.path))} data-testid="tree-row">
              {e.kind === "dir" ? (isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span style={{ width: 12 }} />}
              {e.kind === "dir" ? <Folder size={13} /> : editable(root, e.path) ? <File size={13} /> : <FileLock size={13} />}
              <span className="ellipsis">{e.name}</span>
            </button>
            {e.kind === "dir" && isOpen && <Tree root={root} path={e.path} depth={depth + 1} open={open} toggle={toggle} listings={listings} onFile={onFile} current={current} />}
          </div>
        );
      })}
    </>
  );
}

export default function CodeView() {
  const { boardId, graph } = useBoard();
  const toast = useApp((s) => s.toast);
  const [roots, setRoots] = useState<FsRoot[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [listings, setListings] = useState<Record<string, FsEntry[]>>({});
  const [docs, setDocs] = useState<Doc[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [terminal, setTerminal] = useState(false);
  const [ask, setAsk] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const agents = useMemo(() => graph.nodes.filter((n): n is AgentNode => n.kind === "agent"), [graph]);
  const [askAgent, setAskAgent] = useState<string>("");
  const doc = docs.find((d) => d.key === active) ?? null;

  const load = useCallback(async (root: FsRoot, path: string) => {
    try {
      const l = await engine.list(root.id, path);
      setListings((m) => ({ ...m, [`${root.id}:${path}`]: l.entries }));
    } catch (err) {
      toast({ kind: "fail", text: (err as Error).message });
    }
  }, [toast]);

  useEffect(() => {
    engine.roots(boardId).then((r) => {
      setRoots(r);
      // Folded to start; an agent's workspace/ (where it works) opens with it.
      for (const root of r) if (root.kind === "profile") setOpen((s) => new Set(s).add(`${root.id}:workspace`));
    }).catch(() => undefined);
  }, [boardId, load]);

  /** Keys are `<root id>:<path>`; root ids are `kind:name` (profile:triage, folder:ab12…). */
  const toggle = (key: string) => {
    const next = new Set(open);
    if (next.has(key)) next.delete(key);
    else {
      next.add(key);
      const parts = key.split(":");
      const root = roots.find((r) => r.id === parts.slice(0, 2).join(":"));
      const path = parts.slice(2).join(":");
      if (root && !listings[key]) void load(root, path);
      if (root?.kind === "profile" && path === "" && !listings[`${root.id}:workspace`]) void load(root, "workspace");
    }
    setOpen(next);
  };

  const openFile = async (root: FsRoot, path: string) => {
    const key = `${root.id}:${path}`;
    if (docs.some((d) => d.key === key)) return setActive(key);
    try {
      const f = await engine.read(root.id, path);
      if (f.text === null) return toast({ kind: "info", text: `${path}: ${f.reason ?? "cannot open"}` });
      const model = monaco.editor.createModel(f.text, languageOf(path), monaco.Uri.parse(`mcbot://${encodeURIComponent(root.id)}/${path}`));
      model.onDidChangeContent(() => setDirty((s) => new Set(s).add(key)));
      setDocs((d) => [...d, { key, root, path, saved: f.text!, sha256: f.sha256 ?? null, readOnly: !editable(root, path), model }]);
      setActive(key);
    } catch (err) {
      toast({ kind: "fail", text: (err as Error).message });
    }
  };

  const close = (key: string) => {
    const d = docs.find((x) => x.key === key);
    if (d && dirty.has(key) && !confirm(`${d.path} has changes that are not saved. Close it anyway?`)) return;
    d?.model.dispose();
    const rest = docs.filter((x) => x.key !== key);
    setDocs(rest);
    setDirty((s) => { const n = new Set(s); n.delete(key); return n; });
    if (active === key) setActive(rest.at(-1)?.key ?? null);
  };

  const save = useCallback(async () => {
    const d = docs.find((x) => x.key === active);
    if (!d || d.readOnly) return;
    try {
      const text = d.model.getValue();
      const r = await engine.writeFile(d.root.id, d.path, text, d.sha256);
      setDocs((all) => all.map((x) => (x.key === d.key ? { ...x, saved: text, sha256: r.sha256 } : x)));
      setDirty((s) => { const n = new Set(s); n.delete(d.key); return n; });
    } catch (err) {
      toast({ kind: "fail", text: (err as Error).message });
    }
  }, [docs, active, toast]);

  // One editor; each open file is a Monaco model it shows.
  useEffect(() => {
    if (!host.current || editor.current) return;
    editor.current = monaco.editor.create(host.current, {
      theme: "mcbot", automaticLayout: true, minimap: { enabled: false }, fontSize: 13, fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--mono"),
      scrollBeyondLastLine: false, padding: { top: 12 }, renderLineHighlight: "line", smoothScrolling: true,
    });
    return () => {
      editor.current?.dispose();
      editor.current = null;
    };
  }, [doc !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!editor.current) return;
    editor.current.setModel(doc?.model ?? null);
    editor.current.updateOptions({ readOnly: doc?.readOnly ?? true });
  }, [doc]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
      if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        setTerminal((t) => !t);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);
  useEffect(() => () => { for (const d of docs) d.model.dispose(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // "Ask an agent about this": the selection (or the whole file) goes along with the question.
  const askAbout = async () => {
    const agent = agents.find((a) => a.id === (askAgent || agents[0]?.id));
    if (!doc || !agent || !ask.trim()) return;
    const sel = editor.current?.getSelection();
    const text = sel && !sel.isEmpty() ? doc.model.getValueInRange(sel) : doc.model.getValue();
    const where = sel && !sel.isEmpty() ? `${doc.path}, lines ${sel.startLineNumber}–${sel.endLineNumber}` : doc.path;
    const full = [doc.root.path, doc.path].join(sep(doc.root.path));
    const runId = await runAgent(boardId, agent.id, `${ask.trim()}\n\nFile: ${full} (${where})\n\n\`\`\`${doc.model.getLanguageId()}\n${text.slice(0, 40_000)}\n\`\`\``);
    if (runId) {
      setAsk("");
      toast({ kind: "ok", text: `Asked ${agent.data.displayName || agent.data.name}`, action: { label: "Open", run: () => useApp.getState().openChat(agent.id) } });
    }
  };

  const cwd = doc ? (doc.root.kind === "profile" ? [doc.root.path, "workspace"].join(sep(doc.root.path)) : doc.root.path) : roots[0] ? (roots[0].kind === "profile" ? [roots[0].path, "workspace"].join(sep(roots[0].path)) : roots[0].path) : null;
  const groups: { label: string; kinds: FsRoot["kind"][] }[] = [{ label: "Agents", kinds: ["profile"] }, { label: "Folders", kinds: ["workspace", "folder"] }];

  return (
    <>
      <Sidebar title="Code" testId="code-sidebar" action={
        <button className="icon-btn sm" aria-label="Open a folder" data-tip="Open a folder" onClick={() => useApp.getState().setPalette(true)}><FolderPlus size={14} /></button>
      }>
        {groups.map((g) => {
          const list = roots.filter((r) => g.kinds.includes(r.kind));
          if (!list.length) return null;
          return (
            <div key={g.label}>
              <SidebarGroup label={g.label} />
              {list.map((r) => {
                const key = `${r.id}:`;
                const isOpen = open.has(key);
                return (
                  <div key={r.id}>
                    <button className="tree-row root" onClick={() => toggle(key)} aria-expanded={isOpen}>
                      {r.kind === "profile" ? <AgentFace seed={r.id.slice(8)} size={16} /> : <Folder size={13} />}
                      <span className="ellipsis">{r.name}</span>
                    </button>
                    {isOpen && <Tree root={r} path="" depth={1} open={open} toggle={toggle} listings={listings} onFile={(root, p) => void openFile(root, p)} current={active} />}
                  </div>
                );
              })}
            </div>
          );
        })}
        {roots.length === 0 && <div className="faint" style={{ padding: "8px 10px" }}>Compile the board, or open a folder.</div>}
      </Sidebar>
      <section className="main code-main">
        <div className="code-tabs" role="tablist">
          {docs.map((d) => (
            <div key={d.key} role="tab" aria-selected={d.key === active} className="code-tab" onClick={() => setActive(d.key)} data-tip={d.readOnly ? "Read only: it comes from the board" : undefined}>
              {d.readOnly && <FileLock size={11} />}
              <span className="ellipsis">{d.path.split("/").pop()}</span>
              {dirty.has(d.key) ? <span className="dot" /> : null}
              <button className="icon-btn sm" aria-label={`Close ${d.path}`} onClick={(e) => { e.stopPropagation(); close(d.key); }}><X size={11} /></button>
            </div>
          ))}
          <span className="grow" />
          {doc && !doc.readOnly && <button className="btn sm ghost" disabled={!dirty.has(doc.key)} onClick={() => void save()} data-tip="⌘S"><Save size={12} /> Save</button>}
          {url !== null ? (
            <input className="code-url" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Web address" data-testid="browser-url"
              onKeyDown={(e) => {
                if (e.key === "Escape") setUrl(null);
                if (e.key === "Enter" && url.trim()) void openBrowser(url.trim()).then(() => setUrl(null)).catch((err: unknown) => toast({ kind: "fail", text: String(err) }));
              }} onBlur={() => setUrl(null)} />
          ) : (
            <button className="icon-btn sm" aria-label="Preview in the browser" data-tip="Preview a page: what an agent built, a report…" onClick={() => setUrl("http://localhost:3000")} data-testid="browser-open"><Globe size={14} /></button>
          )}
          <button className="icon-btn sm" aria-pressed={terminal} aria-label="Terminal" data-tip="Terminal  ⌃`" onClick={() => setTerminal(!terminal)} data-testid="terminal-toggle"><PanelBottom size={14} /></button>
        </div>
        <div className={`code-body${terminal ? " with-terminal" : ""}`}>
          <div className="code-editor">
            {doc ? <div ref={host} className="monaco-host" data-testid="editor" /> : <Empty title="Open a file">Pick one on the left. <Kbd>⌘S</Kbd> saves.</Empty>}
          </div>
          {doc && agents.length > 0 && (
            <div className="code-ask">
              <Sparkles size={13} className="faint" />
              <select value={askAgent || agents[0]!.id} onChange={(e) => setAskAgent(e.target.value)} aria-label="Agent">
                {agents.map((a) => <option key={a.id} value={a.id}>{a.data.displayName || a.data.name}</option>)}
              </select>
              <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Ask about the selection: explain this, fix this…" onKeyDown={(e) => { if (e.key === "Enter") void askAbout(); }} data-testid="code-ask" />
            </div>
          )}
          {terminal && cwd && <div className="code-terminal"><TerminalPanel key={cwd} cwd={cwd} /></div>}
        </div>
      </section>
    </>
  );
}
