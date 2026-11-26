/**
 * One root's folders as a map (the read-only GraphCanvas, as every structural view): the folders
 * open in the tree are open here, a click on a folder opens or folds it, a click on a file opens it.
 * Dotfiles stay hidden, as in Finder; a long folder shows FOLD entries until "+N more".
 */
import { ChevronRight, Folder, FolderOpen } from "lucide-react";
import { useMemo, useState } from "react";
import type { FsEntry, FsListing, FsRoot } from "../../contracts/api";
import { PROFILE_DIRS } from "../../compile/index";
import { bytes } from "../lib/format";
import { layoutTree, type TreeIn } from "../lib/tree";
import { AgentFace } from "../ui";
import { GraphCanvas, type GEdge, type GNode } from "../views/GraphCanvas";
import { extOf, keyOf } from "./paths";

const FOLD = 12;
const ALL = 60;
/** An agent's folder leads with what McBot writes, then the compile layout's folders; Hermes' caches and locks fold away. */
const rank = (e: FsEntry, profile: boolean): number => {
  if (!profile) return 0;
  if (e.owned) return 0;
  const known = (PROFILE_DIRS as readonly string[]).indexOf(e.name);
  if (e.kind === "dir" && known >= 0) return 1 + known / 100;
  return e.kind === "dir" ? 2 : 3;
};
const tag = (name: string) => extOf(name).slice(0, 4);

export function FolderMap({ root, listings, open, selected, onToggle, onFile }: {
  root: FsRoot;
  listings: Readonly<Record<string, FsListing>>;
  /** Open folders, as `<root id>:<path>` (the root itself is always open). */
  open: ReadonlySet<string>;
  selected: string | null;
  onToggle: (path: string) => void;
  onFile: (path: string) => void;
}) {
  const [unfolded, setUnfolded] = useState<Set<string>>(new Set());
  const isOpen = (path: string) => path === "" || open.has(keyOf(root.id, path));

  const { nodes, edges, byId } = useMemo(() => {
    const byId = new Map<string, FsEntry>();
    const profile = root.kind === "profile";
    const hidden = new Map<string, number>();
    const childrenOf = (path: string): TreeIn[] => {
      const l = listings[keyOf(root.id, path)];
      if (!l || !isOpen(path)) return [];
      const visible = l.entries.filter((e) => !e.name.startsWith(".")).map((e, i) => ({ e, i }))
        .sort((a, b) => rank(a.e, profile && path === "") - rank(b.e, profile && path === "") || a.i - b.i).map((x) => x.e);
      const more = unfolded.has(path);
      const shown = visible.slice(0, more ? ALL : FOLD);
      const kids: TreeIn[] = shown.map((e) => {
        byId.set(`p:${e.path}`, e);
        return { id: `p:${e.path}`, children: e.kind === "dir" ? childrenOf(e.path) : [] };
      });
      const rest = visible.length - shown.length + l.truncated;
      hidden.set(path, rest);
      if (rest > 0 || (more && visible.length > FOLD)) kids.push({ id: `fold:${path}`, height: 34 });
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
        const rest = hidden.get(path) ?? 0;
        const more = unfolded.has(path);
        ns.push({ id: t.id, x: p.x, y: p.y, className: "more", content: <span data-testid="files-more">{more ? "Show less" : `+${rest} more`}{more && rest > 0 && <span className="faint"> · {rest} not shown</span>}</span> });
      } else {
        const e = byId.get(t.id)!;
        const opened = isOpen(e.path);
        ns.push({
          id: t.id, x: p.x, y: p.y, content: e.kind === "dir" ? (
            <>
              <span className="tile sm folder">{opened ? <FolderOpen size={13} /> : <Folder size={13} />}</span>
              <span className="grow"><span className="label ellipsis" style={{ display: "block" }}>{e.name}</span><span className="sub">{e.children ?? 0} item{e.children === 1 ? "" : "s"}</span></span>
              <ChevronRight size={14} className="faint" style={{ transform: opened ? "rotate(90deg)" : undefined, transition: "transform .2s" }} />
            </>
          ) : (
            <>
              <span className={`ext ${tag(e.name)}`}>{tag(e.name) || "·"}</span>
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
  }, [root, listings, open, unfolded]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSelect = (id: string | null) => {
    if (!id || id === "p:") return;
    if (id.startsWith("fold:")) {
      const path = id.slice(5);
      setUnfolded((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      return;
    }
    const e = byId.get(id);
    if (!e) return;
    if (e.kind === "dir") onToggle(e.path);
    else onFile(e.path);
  };

  const openCount = [...open].filter((k) => k.startsWith(`${root.id}:`)).length;
  return (
    <div className="graph-area" data-testid="files-graph">
      <GraphCanvas key={root.id} nodes={nodes} edges={edges} selected={selected ? `p:${selected}` : null} onSelect={onSelect}
        fitSignature={`${root.id}:${Object.keys(listings).filter((k) => k.startsWith(`${root.id}:`)).length}:${openCount}:${unfolded.size}`} />
    </div>
  );
}
