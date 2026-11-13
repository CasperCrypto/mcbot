import { ChevronRight, Folder, FolderOpen, FolderPlus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FsEntry, FsListing, FsPreview, FsRoot } from "../../contracts/api";
import { PROFILE_DIRS } from "../../compile/index";
import { bytes } from "../lib/format";
import { engine } from "../lib/engine";
import { layoutTree, type TreeIn } from "../lib/tree";
import { Sidebar, SidebarGroup } from "../shell/Sidebar";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { AgentFace, Empty } from "../ui";
import { GraphCanvas, type GEdge, type GNode } from "./GraphCanvas";

/** A folder shows this many entries until "+N more" is clicked, then up to ALL. */
const FOLD = 12;
const ALL = 60;
/** Profile roots lead with what McBot writes, then the dirs of the compile layout; Hermes' caches and locks fold away. */
const rank = (e: FsEntry, profile: boolean): number => {
  if (!profile) return 0;
  if (e.owned) return 0;
  const known = (PROFILE_DIRS as readonly string[]).indexOf(e.name);
  if (e.kind === "dir" && known >= 0) return 1 + known / 100;
  return e.kind === "dir" ? 2 : 3;
};
const ext = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase().slice(0, 4) : "");

export function FilesView() {
  const { boardId } = useBoard();
  const compile = useApp((s) => s.compile);
  const [roots, setRoots] = useState<FsRoot[]>([]);
  const [rootId, setRootId] = useState<string | null>(null);
  const [listings, setListings] = useState<Record<string, FsListing>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [unfolded, setUnfolded] = useState<Set<string>>(new Set());
  const [file, setFile] = useState<{ path: string; preview: FsPreview | null } | null>(null);
  const openedFolder = useApp((s) => s.openedFolder);
  const pick = () => useApp.getState().setFolderPickerOpen(true);

  const loadRoots = useCallback(async () => {
    const list = await engine.roots(boardId).catch(() => [] as FsRoot[]);
    setRoots(list);
    return list;
  }, [boardId]);
  useEffect(() => {
    void loadRoots();
  }, [loadRoots, compile]);
  // A folder opened from the picker: show it.
  useEffect(() => {
    if (!openedFolder) return;
    void loadRoots().then(() => setRootId(openedFolder.id));
  }, [openedFolder, loadRoots]);

  const root = roots.find((r) => r.id === rootId) ?? roots[0] ?? null;
  const fetchDir = useCallback(async (rid: string, path: string) => {
    const l = await engine.list(rid, path).catch(() => null);
    if (l) setListings((prev) => ({ ...prev, [path]: l }));
  }, []);
  useEffect(() => {
    if (!root) return;
    setListings({});
    setExpanded(new Set([""]));
    setUnfolded(new Set());
    setFile(null);
    void fetchDir(root.id, "");
  }, [root?.id, fetchDir]); // eslint-disable-line react-hooks/exhaustive-deps

  const unfold = (path: string) => setUnfolded((prev) => {
    const next = new Set(prev);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });
  const toggle = (path: string) => {
    if (!root) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else {
        next.add(path);
        if (!listings[path]) void fetchDir(root.id, path);
      }
      return next;
    });
  };
  const preview = (path: string) => {
    if (!root) return;
    setFile({ path, preview: null });
    engine.read(root.id, path).then((p) => setFile({ path, preview: p })).catch((e) => setFile({ path, preview: { path, bytes: 0, text: null, reason: (e as Error).message } }));
  };

  const { nodes, edges, byId } = useMemo(() => {
    const byId = new Map<string, FsEntry>();
    if (!root) return { nodes: [] as GNode[], edges: [] as GEdge[], byId };
    const profile = root.kind === "profile";
    const hidden = new Map<string, number>();
    const childrenOf = (path: string): TreeIn[] => {
      const l = listings[path];
      if (!l || !expanded.has(path)) return [];
      // Dotfiles stay hidden, as in Finder.
      const visible = l.entries.filter((e) => !e.name.startsWith(".")).map((e, i) => ({ e, i }))
        .sort((a, b) => rank(a.e, profile && path === "") - rank(b.e, profile && path === "") || a.i - b.i).map((x) => x.e);
      const open = unfolded.has(path);
      const shown = visible.slice(0, open ? ALL : FOLD);
      const kids: TreeIn[] = shown.map((e) => {
        byId.set(`p:${e.path}`, e);
        return { id: `p:${e.path}`, children: e.kind === "dir" ? childrenOf(e.path) : [] };
      });
      const more = visible.length - shown.length + l.truncated;
      hidden.set(path, more);
      if (more > 0 || (open && visible.length > FOLD)) kids.push({ id: `fold:${path}`, height: 34 });
      return kids;
    };
    const tree: TreeIn = { id: "p:", height: 60, children: childrenOf("") };
    const pos = layoutTree(tree, { column: 340, row: 57, gap: 12 });
    const ns: GNode[] = [];
    const es: GEdge[] = [];
    const walk = (t: TreeIn, parent: string | null) => {
      const p = pos.get(t.id)!;
      if (t.id === "p:") {
        ns.push({
          id: t.id, x: p.x, y: p.y, className: "root", content: (
            <>
              {root.kind === "profile" ? <AgentFace seed={root.id.slice(8)} size={36} /> : <span className="tile folder"><FolderOpen size={16} /></span>}
              <span className="grow"><span className="label ellipsis" style={{ display: "block" }}>{root.name}</span><span className="sub ellipsis mono" style={{ display: "block", maxWidth: 220 }}>{root.path}</span></span>
            </>
          ),
        });
      } else if (t.id.startsWith("fold:")) {
        const path = t.id.slice(5);
        const more = hidden.get(path) ?? 0;
        const open = unfolded.has(path);
        ns.push({
          id: t.id, x: p.x, y: p.y, className: "more", content: (
            <span data-testid="files-more">{open ? "Show less" : `+${more} more`}{open && more > 0 && <span className="faint"> · {more} not shown</span>}</span>
          ),
        });
      } else {
        const e = byId.get(t.id)!;
        const open = expanded.has(e.path);
        ns.push({
          id: t.id, x: p.x, y: p.y, content: e.kind === "dir" ? (
            <>
              <span className="tile sm folder">{open ? <FolderOpen size={13} /> : <Folder size={13} />}</span>
              <span className="grow"><span className="label ellipsis" style={{ display: "block" }}>{e.name}</span><span className="sub">{e.children ?? 0} item{e.children === 1 ? "" : "s"}</span></span>
              <ChevronRight size={14} className="faint" style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform .2s" }} />
            </>
          ) : (
            <>
              <span className={`ext ${ext(e.name)}`}>{ext(e.name) || "·"}</span>
              <span className="grow"><span className="label ellipsis" style={{ display: "block" }}>{e.name}</span><span className="sub num">{bytes(e.bytes)}</span></span>
              {e.owned && <span className="owned" data-tip="Written by McBot" data-tip-side="top" />}
            </>
          ),
        });
      }
      if (parent) es.push({ id: `${parent}->${t.id}`, source: parent, target: t.id });
      for (const c of t.children ?? []) walk(c, t.id);
    };
    walk(tree, null);
    return { nodes: ns, edges: es, byId };
  }, [root, listings, expanded, unfolded]);

  const onSelect = (id: string | null) => {
    if (!id || id === "p:") return;
    if (id.startsWith("fold:")) return unfold(id.slice(5));
    const e = byId.get(id);
    if (!e) return;
    if (e.kind === "dir") toggle(e.path);
    else preview(e.path);
  };

  const profiles = roots.filter((r) => r.kind === "profile");
  const places = roots.filter((r) => r.kind !== "profile");
  const row = (r: FsRoot) => (
    <button key={r.id} className="list-row" aria-selected={root?.id === r.id} onClick={() => setRootId(r.id)} data-testid="files-root">
      {r.kind === "profile" ? <AgentFace seed={r.id.slice(8)} size={26} /> : <span className="tile sm folder"><Folder size={13} /></span>}
      <span className="grow" style={{ display: "grid" }}>
        <span className="title ellipsis">{r.name}</span>
        <span className="sub ellipsis mono" style={{ fontSize: 10.5 }}>{r.path}</span>
      </span>
      {r.kind === "folder" && (
        <span className="icon-btn sm" role="button" aria-label="Close folder" onClick={async (e) => { e.stopPropagation(); await engine.closeFolder(r.id); const list = await loadRoots(); if (rootId === r.id) setRootId(list[0]?.id ?? null); }}><X size={12} /></span>
      )}
    </button>
  );

  return (
    <>
      <Sidebar title="Files" action={<button className="icon-btn sm" aria-label="Open folder" data-tip="Open folder" data-tip-side="bottom" onClick={pick} data-testid="open-folder"><FolderPlus size={14} /></button>}>
        {profiles.length > 0 && <SidebarGroup label="Agents" />}
        {profiles.map(row)}
        <SidebarGroup label="Folders" />
        {places.map(row)}
        <button className="list-row faint" onClick={pick} data-testid="open-folder-row">
          <span className="tile sm folder"><FolderPlus size={13} /></span><span className="grow">Open a folder…</span>
        </button>
      </Sidebar>
      <section className="main" data-testid="files-graph">
        {!root ? <Empty title="No folders yet" action={<button className="btn primary" onClick={pick}><FolderPlus size={14} /> Open a folder</button>} /> : (
          <div className="view">
            <div className={`graph-area${file ? " with-panel" : ""}`}><GraphCanvas key={root.id} nodes={nodes} edges={edges} selected={file ? `p:${file.path}` : null} onSelect={onSelect} fitSignature={`${root.id}:${Object.keys(listings).length}:${expanded.size}:${unfolded.size}:${!!file}`} /></div>
            {file && (
              <aside className="side-panel glass" data-testid="file-preview">
                <div className="side-panel-head">
                  <span className={`ext ${ext(file.path)}`}>{ext(file.path) || "·"}</span>
                  <b className="grow ellipsis mono" style={{ fontSize: 12 }}>{file.path}</b>
                  <button className="icon-btn" aria-label="Close" onClick={() => setFile(null)}><X size={15} /></button>
                </div>
                <div className="side-panel-body">
                  {file.preview === null ? <span className="faint">Loading…</span> : file.preview.text !== null ? <pre className="code">{file.preview.text || " "}</pre> : <span className="faint">{file.preview.reason}</span>}
                </div>
              </aside>
            )}
          </div>
        )}
      </section>
    </>
  );
}
