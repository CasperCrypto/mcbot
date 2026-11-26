/**
 * The Files sidebar: every place (the agents' folders, the shared files, folders you opened) as one
 * tree. A click opens a file or folds a folder; right-click or "…" has its actions; drag a row onto a
 * folder to move it there; drop files from the computer on a folder to add them. Rename and New
 * happen in place, as in Finder. The view owns all state (views/FilesView.tsx); this only draws it.
 */
import { ChevronDown, ChevronRight, File, FileLock, Folder, FolderOpen, MoreHorizontal } from "lucide-react";
import { useEffect, useRef, type DragEvent, type KeyboardEvent } from "react";
import type { FsEntry, FsListing, FsRoot } from "../../contracts/api";
import { agentEditable, changeable } from "../../harness/live";
import { SidebarGroup } from "../shell/Sidebar";
import { AgentFace } from "../ui";
import { keyOf, stemEnd } from "./paths";

export type Editing =
  | { kind: "rename"; key: string }
  | { kind: "new-file" | "new-folder"; rootId: string; dir: string; name: string }
  | null;

export interface TreeState {
  roots: readonly FsRoot[];
  listings: Readonly<Record<string, FsListing>>;
  /** Open folders as `<root id>:<path>`; a root is open when `<root id>:` is. */
  open: ReadonlySet<string>;
  selected: string | null;
  dirty: ReadonlySet<string>;
  editing: Editing;
  /** The folder a drag is over. */
  dropAt: string | null;
}

export interface TreeHandlers {
  /** A row was clicked: a file opens, a folder folds or unfolds (`entry` null = the root itself). */
  pick(root: FsRoot, entry: FsEntry | null): void;
  menu(root: FsRoot, entry: FsEntry | null, x: number, y: number): void;
  /** Rename or New finished: the name typed, or null when cancelled. */
  commit(value: string | null): void;
  key(root: FsRoot, entry: FsEntry | null, e: KeyboardEvent): void;
  dragStart(root: FsRoot, entry: FsEntry, e: DragEvent): void;
  dragOver(root: FsRoot, entry: FsEntry | null, e: DragEvent): void;
  drop(root: FsRoot, entry: FsEntry | null, e: DragEvent): void;
}

const indent = (depth: number) => ({ paddingLeft: 8 + depth * 14 });

export function FileTree({ s, h }: { s: TreeState; h: TreeHandlers }) {
  const groups: { label: string; kinds: FsRoot["kind"][] }[] = [{ label: "Agents", kinds: ["profile"] }, { label: "Folders", kinds: ["workspace", "folder"] }];
  return (
    <div role="tree" aria-label="Files">
      {groups.map((g) => {
        const list = s.roots.filter((r) => g.kinds.includes(r.kind));
        if (!list.length) return null;
        return (
          <div key={g.label}>
            <SidebarGroup label={g.label} />
            {list.map((r) => <RootRow key={r.id} root={r} s={s} h={h} />)}
          </div>
        );
      })}
    </div>
  );
}

function More({ onOpen }: { onOpen: (x: number, y: number) => void }) {
  return (
    <span className="tree-more" role="button" tabIndex={-1} aria-label="More" onClick={(e) => {
      e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect();
      onOpen(r.left, r.bottom + 4);
    }}><MoreHorizontal size={13} /></span>
  );
}

function RootRow({ root, s, h }: { root: FsRoot; s: TreeState; h: TreeHandlers }) {
  const key = keyOf(root.id, "");
  const open = s.open.has(key);
  return (
    <div role="treeitem" aria-expanded={open} aria-selected={s.selected === key}>
      <button className={`tree-row root${s.dropAt === key ? " drop" : ""}`} aria-selected={s.selected === key} onClick={() => h.pick(root, null)}
        onContextMenu={(e) => { e.preventDefault(); h.menu(root, null, e.clientX, e.clientY); }} onKeyDown={(e) => h.key(root, null, e)}
        onDragOver={(e) => h.dragOver(root, null, e)} onDrop={(e) => h.drop(root, null, e)} data-testid="files-root" title={root.path}>
        {root.kind === "profile" ? <AgentFace seed={root.id.slice(8)} size={16} /> : <Folder size={13} />}
        <span className="ellipsis grow">{root.name}</span>
        <More onOpen={(x, y) => h.menu(root, null, x, y)} />
      </button>
      {open && <Rows root={root} path="" depth={1} s={s} h={h} />}
    </div>
  );
}

function Rows({ root, path, depth, s, h }: { root: FsRoot; path: string; depth: number; s: TreeState; h: TreeHandlers }) {
  const listing = s.listings[keyOf(root.id, path)];
  const adding = s.editing && s.editing.kind !== "rename" && s.editing.rootId === root.id && s.editing.dir === path ? s.editing : null;
  if (!listing) return <div className="tree-row" style={indent(depth)} aria-hidden="true"><span className="skeleton tree-skel" /></div>;
  return (
    <div role="group">
      {adding && <NameInput depth={depth} initial={adding.name} folder={adding.kind === "new-folder"} onDone={h.commit} />}
      {listing.entries.map((e) => <Row key={e.path} root={root} entry={e} depth={depth} s={s} h={h} />)}
      {listing.entries.length === 0 && !adding && <div className="tree-row faint tree-empty" style={indent(depth + 1)}>Empty</div>}
      {listing.truncated > 0 && <div className="tree-row faint" style={indent(depth + 1)}>{listing.truncated} more not shown</div>}
    </div>
  );
}

function Row({ root, entry, depth, s, h }: { root: FsRoot; entry: FsEntry; depth: number; s: TreeState; h: TreeHandlers }) {
  const key = keyOf(root.id, entry.path);
  const dir = entry.kind === "dir";
  const open = dir && s.open.has(key);
  if (s.editing?.kind === "rename" && s.editing.key === key) return <NameInput depth={depth} initial={entry.name} folder={dir} onDone={h.commit} />;
  const locked = !dir && root.kind === "profile" && !agentEditable(entry.path);
  return (
    <div role="treeitem" aria-expanded={dir ? open : undefined} aria-selected={s.selected === key}>
      <button className={`tree-row${s.dropAt === key ? " drop" : ""}${entry.name.startsWith(".") ? " dim" : ""}`} aria-selected={s.selected === key} style={indent(depth)}
        draggable={changeable(root.id, entry.path)} onClick={() => h.pick(root, entry)}
        onContextMenu={(e) => { e.preventDefault(); h.menu(root, entry, e.clientX, e.clientY); }} onKeyDown={(e) => h.key(root, entry, e)}
        onDragStart={(e) => h.dragStart(root, entry, e)} onDragOver={(e) => h.dragOver(root, entry, e)} onDrop={(e) => h.drop(root, entry, e)}
        data-testid="tree-row" data-path={entry.path}>
        {dir ? (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span style={{ width: 12, flex: "none" }} />}
        {dir ? (open ? <FolderOpen size={13} /> : <Folder size={13} />) : locked ? <FileLock size={13} /> : <File size={13} />}
        <span className="ellipsis grow">{entry.name}</span>
        {s.dirty.has(key) && <span className="dot" aria-label="Not saved" />}
        <More onOpen={(x, y) => h.menu(root, entry, x, y)} />
      </button>
      {open && <Rows root={root} path={entry.path} depth={depth + 1} s={s} h={h} />}
    </div>
  );
}

/** A name typed in place: Enter keeps it, Esc leaves it as it was; the part before the extension is selected first. */
function NameInput({ depth, initial, folder, onDone }: { depth: number; initial: string; folder: boolean; onDone: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest" });
    el.setSelectionRange(0, folder ? initial.length : stemEnd(initial));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <div className="tree-row editing" style={indent(depth)}>
      <span style={{ width: 12, flex: "none" }} />
      {folder ? <Folder size={13} /> : <File size={13} />}
      <input ref={ref} className="tree-input" defaultValue={initial} spellCheck={false} aria-label={folder ? "Folder name" : "File name"} data-testid="tree-name"
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(e.currentTarget.value);
          if (e.key === "Escape") { e.stopPropagation(); finish(null); }
        }} onBlur={(e) => finish(e.currentTarget.value)} />
    </div>
  );
}
