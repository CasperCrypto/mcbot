/**
 * Files (⌘7): every folder the agents work in, the shared files and the folders you open, in one
 * place to read, change and hand to an agent. Text and code open in the editor (Markdown as a page
 * first), pictures, video, sound and drawings as themselves; Map shows a folder as a graph. Drop files
 * or whole folders from the computer anywhere here, make files and folders, rename, move (drag a
 * row onto a folder), delete (it waits in the trash: Undo or ⌘Z), open a terminal there, and ask an
 * agent about what is open. What may change where is src/harness/live.ts (an agent's own settings
 * are edited, never moved; only its workspace/ takes new files), and the engine enforces it.
 *
 * The view unmounts when you leave it, so what you had open, unsaved text included, waits in
 * `session` until you come back.
 */
import { Eye, FilePlus, FolderInput, FolderPlus, FolderSearch, Link, MessageSquare, Network, PanelBottom, Pencil, Plus, Save, Trash2, Upload, X, FileLock } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import type { FsEntry, FsListing, FsRoot } from "../../contracts/api";
import { addable, agentEditable, changeable } from "../../harness/live";
import { RichText } from "../chat/RichText";
import type { EditorDoc, EditorHandle } from "../files/CodeEditor";
import { FileTree, type Editing } from "../files/FileTree";
import { FolderMap } from "../files/FolderMap";
import { Preview } from "../files/Preview";
import { RowMenu, type MenuItem } from "../files/RowMenu";
import { hasFiles, placeDrop, takeDrop, type Dropped } from "../files/drop";
import { absolute, baseName, folderBrief, folderFor, freeName, joinPath, keyOf, parentOf, readsAsPage, shownAs, splitKey, within, type Shown } from "../files/paths";
import { engine } from "../lib/engine";
import { canReveal, revealFile, revealLabel } from "../lib/open";
import { AskBar } from "../shell/AskBar";
import { Sidebar } from "../shell/Sidebar";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { Empty, SkeletonCards } from "../ui";

const CodeEditor = lazy(() => import("../files/CodeEditor"));
const TerminalPanel = lazy(() => import("../workbench/TerminalPanel").then((m) => ({ default: m.TerminalPanel })));

/** A row being dragged inside the tree (to move it). */
const MOVE = "application/x-mcbot-file";

interface Doc extends EditorDoc {
  rootId: string;
  sha256: string | null;
  /** Markdown shown as a page (true) or in the editor. */
  page: boolean;
}

type Main =
  | { kind: "doc" }
  | { kind: "preview"; key: string; shown: Exclude<Shown, "text">; size: number | null; reason?: string }
  | { kind: "map"; rootId: string }
  | null;

/** What Files keeps while another view is open: what was open, unsaved text, where you were. */
const session = {
  docs: [] as Doc[],
  active: null as string | null,
  main: null as Main,
  open: new Set<string>(),
  selected: null as string | null,
  terminal: false,
  /** Unsaved text per open file, kept when the editor goes (CodeEditor writes it on unmount). */
  drafts: new Map<string, string>(),
  /** Deleted items, newest last, for Undo and ⌘Z. */
  trash: [] as string[],
};

const typing = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("input, textarea, [contenteditable='true'], .monaco-editor, .xterm");

export function FilesView() {
  const { boardId } = useBoard();
  const toast = useApp((s) => s.toast);
  const compile = useApp((s) => s.compile);
  const openedFolder = useApp((s) => s.openedFolder);
  const selectedNode = useApp((s) => s.selectedNodeId);
  const [roots, setRoots] = useState<FsRoot[]>([]);
  const [listings, setListings] = useState<Record<string, FsListing>>({});
  const [open, setOpenState] = useState<Set<string>>(session.open);
  const [selected, setSelectedState] = useState<string | null>(session.selected);
  const [docs, setDocsState] = useState<Doc[]>(session.docs);
  const [active, setActiveState] = useState<string | null>(session.active);
  const [main, setMainState] = useState<Main>(session.main);
  const [dirty, setDirty] = useState<Set<string>>(() => new Set(session.drafts.keys()));
  const [editing, setEditing] = useState<Editing>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; root: FsRoot; entry: FsEntry | null } | null>(null);
  const [dropAt, setDropAt] = useState<string | null>(null);
  const [mainDrop, setMainDrop] = useState(false);
  const [terminal, setTerminalState] = useState(session.terminal);
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
  const editor = useRef<EditorHandle>(null);
  const picker = useRef<HTMLInputElement>(null);
  const pickTo = useRef<{ root: FsRoot; dir: string } | null>(null);
  const dragging = useRef<{ rootId: string; path: string } | null>(null);

  // Every change goes to `session` too, so coming back finds it as it was.
  const setOpen = useCallback((f: (s: Set<string>) => Set<string>) => setOpenState((s) => (session.open = f(s))), []);
  const setSelected = (k: string | null) => setSelectedState((session.selected = k));
  const setDocs = useCallback((f: (d: Doc[]) => Doc[]) => setDocsState((d) => (session.docs = f(d))), []);
  const setActive = (k: string | null) => setActiveState((session.active = k));
  const setMain = (m: Main) => setMainState((session.main = m));
  const setTerminal = (t: boolean) => setTerminalState((session.terminal = t));

  const rootOf = useCallback((id: string) => roots.find((r) => r.id === id) ?? null, [roots]);
  const doc = docs.find((d) => d.key === active) ?? null;

  const load = useCallback(async (root: FsRoot, path: string, quiet = false) => {
    try {
      const l = await engine.list(root.id, path);
      setListings((m) => {
        const k = keyOf(root.id, path);
        const was = m[k];
        return was && JSON.stringify(was.entries) === JSON.stringify(l.entries) && was.truncated === l.truncated ? m : { ...m, [k]: l };
      });
      return l;
    } catch (err) {
      if (!quiet) toast({ kind: "fail", text: (err as Error).message });
      return null;
    }
  }, [toast]);

  /** A folder after something in it changed, and its parent (which shows how many items it holds). */
  const refresh = useCallback(async (root: FsRoot, dir: string) => {
    await Promise.all([load(root, dir, true), dir ? load(root, parentOf(dir), true) : null]);
  }, [load]);

  // The places: on open, after every compile (new agents), and when a folder is opened from the picker.
  const loadRoots = useCallback(async () => {
    const list = await engine.roots(boardId).catch(() => [] as FsRoot[]);
    setRoots(list);
    // What was open before, for the places that are still here.
    for (const key of session.open) {
      const { rootId, path } = splitKey(key);
      const r = list.find((x) => x.id === rootId);
      if (r) void load(r, path, true);
    }
    setDocs((d) => d.filter((x) => list.some((r) => r.id === x.rootId)));
    return list;
  }, [boardId, load, setDocs]);
  useEffect(() => {
    void loadRoots();
  }, [loadRoots, compile]);

  const openFolder = useCallback((root: FsRoot, path: string) => {
    const key = keyOf(root.id, path);
    setOpen((s) => new Set(s).add(key));
    void load(root, path);
    // An agent's folder opens with its workspace/ (where it works) open too.
    if (root.kind === "profile" && path === "") {
      setOpen((s) => new Set(s).add(keyOf(root.id, "workspace")));
      void load(root, "workspace", true);
    }
  }, [load, setOpen]);

  // A folder just opened from the picker, or an agent picked elsewhere ("Open its files"): show it.
  useEffect(() => {
    if (!openedFolder) return;
    void loadRoots().then((list) => {
      const r = list.find((x) => x.id === openedFolder.id);
      if (r) { openFolder(r, ""); setSelected(keyOf(r.id, "")); }
    });
  }, [openedFolder]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const r = roots.find((x) => x.nodeId && x.nodeId === selectedNode);
    if (r && !open.has(keyOf(r.id, ""))) { openFolder(r, ""); setSelected(keyOf(r.id, "")); }
  }, [selectedNode, roots]); // eslint-disable-line react-hooks/exhaustive-deps

  // Agents write files while they work: what is open stays current (every few seconds, and when the window comes back).
  useEffect(() => {
    const refresh = () => {
      if (document.hidden) return;
      for (const key of open) {
        const { rootId, path } = splitKey(key);
        const r = roots.find((x) => x.id === rootId);
        if (r) void load(r, path, true);
      }
    };
    const t = setInterval(refresh, 6000);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(t); window.removeEventListener("focus", refresh); };
  }, [open, roots, load]);

  /** What the selection is: a root (`entry` null), a folder or a file. */
  const here = useMemo(() => {
    if (!selected) return null;
    const { rootId, path } = splitKey(selected);
    const root = rootOf(rootId);
    if (!root) return null;
    if (!path) return { root, path, kind: "dir" as const, entry: null };
    const entry = listings[keyOf(rootId, parentOf(path))]?.entries.find((e) => e.path === path) ?? null;
    return { root, path, kind: entry?.kind ?? (docs.some((d) => d.key === selected) ? "file" as const : "dir" as const), entry };
  }, [selected, rootOf, listings, docs]);
  /** Where New, Add files and the terminal act: the folder selected, the folder of the file selected. */
  const target = here ? { root: here.root, dir: folderFor(here.root, here.path, here.kind) } : null;

  // ---- opening ----
  const openFile = async (root: FsRoot, path: string, size: number | null = null) => {
    const key = keyOf(root.id, path);
    setSelected(key);
    const shown = shownAs(baseName(path));
    if (shown !== "text") return setMain({ kind: "preview", key, shown, size });
    if (docs.some((d) => d.key === key)) {
      setActive(key);
      return setMain({ kind: "doc" });
    }
    try {
      const f = await engine.read(root.id, path);
      if (f.text === null) return setMain({ kind: "preview", key, shown: "binary", size: f.bytes, reason: f.reason });
      const d: Doc = { key, rootId: root.id, path, text: f.text, sha256: f.sha256 ?? null, readOnly: root.kind === "profile" && !agentEditable(path), version: 0, page: readsAsPage(path) };
      setDocs((all) => (all.some((x) => x.key === key) ? all : [...all, d]));
      setActive(key);
      setMain({ kind: "doc" });
    } catch (err) {
      toast({ kind: "fail", text: (err as Error).message });
    }
  };

  const pick = (root: FsRoot, entry: FsEntry | null) => {
    if (main?.kind === "map" && main.rootId !== root.id && (!entry || entry.kind === "dir")) setMain({ kind: "map", rootId: root.id });
    if (!entry) {
      const key = keyOf(root.id, "");
      setSelected(key);
      if (open.has(key) && selected === key) setOpen((s) => { const n = new Set(s); n.delete(key); return n; });
      else openFolder(root, "");
      return;
    }
    if (entry.kind === "dir") {
      const key = keyOf(root.id, entry.path);
      setSelected(key);
      if (open.has(key)) setOpen((s) => { const n = new Set(s); n.delete(key); return n; });
      else openFolder(root, entry.path);
      return;
    }
    void openFile(root, entry.path, entry.bytes);
  };

  const closeDoc = (key: string) => {
    const d = docs.find((x) => x.key === key);
    if (d && dirty.has(key) && !confirm(`${baseName(d.path)} has changes that are not saved. Close it anyway?`)) return;
    session.drafts.delete(key);
    setDirty((s) => { const n = new Set(s); n.delete(key); return n; });
    const rest = docs.filter((x) => x.key !== key);
    setDocs(() => rest);
    if (active === key) {
      const next = rest.at(-1)?.key ?? null;
      setActive(next);
      if (main?.kind === "doc") setMain(next ? { kind: "doc" } : d ? { kind: "map", rootId: d.rootId } : null);
    }
  };

  // ---- saving ----
  const reloadDoc = async (key: string) => {
    const d = docs.find((x) => x.key === key);
    if (!d) return;
    const f = await engine.read(d.rootId, d.path).catch(() => null);
    if (!f || f.text === null) return closeDoc(key);
    session.drafts.delete(key);
    setDocs((all) => all.map((x) => (x.key === key ? { ...x, text: f.text!, sha256: f.sha256 ?? null, version: x.version + 1 } : x)));
  };
  const save = useCallback(async () => {
    const d = docs.find((x) => x.key === active);
    if (!d || d.readOnly) return;
    const text = editor.current?.value(d.key) ?? session.drafts.get(d.key) ?? null;
    if (text === null) return;
    try {
      const r = await engine.writeFile(d.rootId, d.path, text, d.sha256);
      session.drafts.delete(d.key);
      setDocs((all) => all.map((x) => (x.key === d.key ? { ...x, text, sha256: r.sha256, version: x.version + 1 } : x)));
      setDirty((s) => { const n = new Set(s); n.delete(d.key); return n; });
      if (r.followed?.length) toast({ kind: "ok", text: `Board updated: ${r.followed.join(", ")}` });
      const root = rootOf(d.rootId);
      if (root) void load(root, parentOf(d.path), true);
    } catch (err) {
      toast({ kind: "fail", text: (err as Error).message, action: { label: "Reload", run: () => void reloadDoc(d.key) } });
    }
  }, [docs, active, toast, rootOf, load]); // eslint-disable-line react-hooks/exhaustive-deps
  const canSave = !!doc && !doc.readOnly && main?.kind === "doc";

  // ---- adding ----
  const addDropped = async (root: FsRoot, dir: string, items: Dropped[], more = false) => {
    if (!items.length) return;
    const listing = listings[keyOf(root.id, dir)] ?? (await load(root, dir));
    const entries = listing?.entries ?? [];
    const placed = placeDrop(items, new Set(entries.map((e) => e.name.toLowerCase())), (w) => freeName(entries, w));
    const files = placed.filter((d) => d.file).length;
    if (files > 10) toast({ kind: "info", text: `Adding ${files} files…` });
    const added: string[] = [];
    const failed: string[] = [];
    for (const d of placed) {
      const at = joinPath(dir, d.dir);
      if (!d.file) {
        await engine.makeFolder(root.id, parentOf(at), baseName(at)).catch(() => undefined);
        continue;
      }
      try {
        added.push((await engine.addFile(root.id, at, d.file.name, d.file)).path);
      } catch (err) {
        failed.push(`${d.file.name}: ${(err as Error).message}`);
      }
    }
    // Show where they went: the folder (and any folder that came with them) opens.
    const folders = [...new Set(placed.filter((d) => d.dir).map((d) => joinPath(dir, d.dir.split("/")[0]!)))];
    for (const p of [dir, ...folders]) { setOpen((s) => new Set(s).add(keyOf(root.id, p))); await refresh(root, p); }
    if (added.length === 1 && !folders.length) void openFile(root, added[0]!);
    const where = dir ? baseName(dir) : root.name;
    if (added.length) toast({ kind: "ok", text: `Added ${added.length === 1 ? baseName(added[0]!) : `${added.length} files`} to ${where}${more ? " (the first 500)" : ""}` });
    if (failed.length) toast({ kind: "fail", text: failed.length === 1 ? failed[0]! : `${failed.length} files couldn't be added. ${failed[0]}` });
  };

  const pickFiles = (root: FsRoot, dir: string) => {
    pickTo.current = { root, dir };
    picker.current?.click();
  };

  const startNew = async (kind: "new-file" | "new-folder", root: FsRoot, dir: string) => {
    if (!addable(root.id, dir)) return;
    if (dir) openFolder(root, dir);
    else if (!open.has(keyOf(root.id, ""))) openFolder(root, "");
    const listing = listings[keyOf(root.id, dir)] ?? (await load(root, dir));
    setEditing({ kind, rootId: root.id, dir, name: freeName(listing?.entries ?? [], kind === "new-file" ? "untitled.md" : "untitled folder") });
  };

  // ---- renaming and moving ----
  /** Open files, unsaved text and open folders follow a rename or a move. */
  const follow = (rootId: string, from: string, to: string) => {
    const move = (key: string) => {
      const { rootId: r, path } = splitKey(key);
      return r === rootId && within(path, from) ? keyOf(r, to + path.slice(from.length)) : key;
    };
    setDocs((all) => all.map((d) => (d.rootId === rootId && within(d.path, from) ? { ...d, key: move(d.key), path: to + d.path.slice(from.length) } : d)));
    for (const [k, v] of [...session.drafts]) if (move(k) !== k) { session.drafts.delete(k); session.drafts.set(move(k), v); }
    setDirty((s) => new Set([...s].map(move)));
    setOpen((s) => new Set([...s].map(move)));
    if (active) setActive(move(active));
    if (selected) setSelected(move(selected));
    if (main?.kind === "preview") setMain({ ...main, key: move(main.key) });
  };
  const moveItem = async (root: FsRoot, from: string, to: string): Promise<boolean> => {
    if (from === to) return false;
    const unsaved = docs.find((d) => d.rootId === root.id && within(d.path, from) && dirty.has(d.key));
    if (unsaved) {
      toast({ kind: "fail", text: `Save ${baseName(unsaved.path)} first` });
      return false;
    }
    try {
      const r = await engine.renameFile(root.id, from, to);
      follow(root.id, from, r.path);
      await Promise.all([refresh(root, parentOf(from)), refresh(root, parentOf(r.path))]);
      return true;
    } catch (err) {
      toast({ kind: "fail", text: (err as Error).message });
      return false;
    }
  };

  const commit = async (value: string | null) => {
    const e = editing;
    setEditing(null);
    const name = value?.trim() ?? "";
    if (!e || !name) return;
    if (e.kind === "rename") {
      const { rootId, path } = splitKey(e.key);
      const root = rootOf(rootId);
      if (root && name !== baseName(path)) await moveItem(root, path, joinPath(parentOf(path), name));
      return;
    }
    const root = rootOf(e.rootId);
    if (!root) return;
    try {
      if (e.kind === "new-folder") {
        const r = await engine.makeFolder(root.id, e.dir, name);
        await refresh(root, e.dir);
        setSelected(keyOf(root.id, r.path));
        openFolder(root, r.path);
      } else {
        const r = await engine.writeFile(root.id, joinPath(e.dir, name), "", null);
        await refresh(root, e.dir);
        await openFile(root, r.path, 0);
        const made = keyOf(root.id, r.path);
        // A new Markdown file starts in the editor, not as an empty page.
        setDocs((all) => all.map((d) => (d.key === made ? { ...d, page: false } : d)));
      }
    } catch (err) {
      toast({ kind: "fail", text: (err as Error).message });
    }
  };

  // ---- deleting ----
  const undo = useCallback(async (id?: string) => {
    const t = id ?? session.trash.at(-1);
    if (!t) return;
    session.trash = session.trash.filter((x) => x !== t);
    try {
      const r = await engine.restoreFile(t);
      const root = rootOf(r.root);
      if (root) {
        openFolder(root, parentOf(r.path));
        await refresh(root, parentOf(r.path));
        setSelected(keyOf(root.id, r.path));
      }
      toast({ kind: "ok", text: `Put back ${baseName(r.path)}` });
    } catch (err) {
      toast({ kind: "fail", text: (err as Error).message });
    }
  }, [rootOf, openFolder, refresh, toast]);

  const remove = async (root: FsRoot, entry: FsEntry) => {
    const unsaved = docs.filter((d) => d.rootId === root.id && within(d.path, entry.path) && dirty.has(d.key));
    if (unsaved.length && !confirm(`${baseName(unsaved[0]!.path)} has changes that are not saved. Delete it anyway?`)) return;
    try {
      const r = await engine.removeFile(root.id, entry.path);
      const gone = (key: string) => { const s = splitKey(key); return s.rootId === root.id && within(s.path, entry.path); };
      for (const k of [...session.drafts.keys()]) if (gone(k)) session.drafts.delete(k);
      const rest = docs.filter((d) => !gone(d.key));
      setDocs(() => rest);
      setDirty((s) => new Set([...s].filter((k) => !gone(k))));
      setOpen((s) => new Set([...s].filter((k) => !gone(k))));
      if (active && gone(active)) setActive(rest.at(-1)?.key ?? null);
      if ((main?.kind === "preview" && gone(main.key)) || (main?.kind === "doc" && active && gone(active))) setMain(rest.length ? { kind: "doc" } : null);
      if (selected && gone(selected)) setSelected(keyOf(root.id, parentOf(entry.path)));
      await refresh(root, parentOf(entry.path));
      session.trash = [...session.trash, r.trash].slice(-20);
      toast({ kind: "ok", text: `Deleted ${r.name}`, action: { label: "Undo", run: () => void undo(r.trash) } });
    } catch (err) {
      toast({ kind: "fail", text: (err as Error).message });
    }
  };

  // ---- keys: ⌘S saves the file, ⌘Z puts back what was deleted, ⌃` the terminal ----
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s" && canSave && !e.defaultPrevented) {
        e.preventDefault();
        void save();
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === "z" && !typing(e.target) && session.trash.length) {
        // The board's ⌘Z listens everywhere (state/board.tsx): here it puts a deleted file back instead.
        e.preventDefault();
        e.stopImmediatePropagation();
        void undo();
      } else if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        setTerminal(!session.terminal);
      }
    };
    // Capture: before the window's other listeners (the board's undo, ⌘S compile).
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [save, undo, canSave]);

  const rowKey = (root: FsRoot, entry: FsEntry | null, e: KeyboardEvent) => {
    if (!entry) return;
    if (e.key === "F2" && changeable(root.id, entry.path)) {
      e.preventDefault();
      setEditing({ kind: "rename", key: keyOf(root.id, entry.path) });
    } else if (((e.metaKey && e.key === "Backspace") || e.key === "Delete") && changeable(root.id, entry.path)) {
      e.preventDefault();
      void remove(root, entry);
    }
  };

  // ---- dragging: rows move inside their place, files from the computer are added ----
  const dropFolder = (root: FsRoot, entry: FsEntry | null, e: DragEvent): string | null => {
    if (hasFiles(e.dataTransfer)) return folderFor(root, entry?.path ?? "", entry?.kind ?? "dir");
    const src = dragging.current;
    if (!src || src.rootId !== root.id || ![...e.dataTransfer.types].includes(MOVE)) return null;
    const dir = entry ? (entry.kind === "dir" ? entry.path : parentOf(entry.path)) : root.kind === "profile" ? "workspace" : "";
    return addable(root.id, dir) && !within(dir, src.path) && dir !== parentOf(src.path) ? dir : null;
  };
  const tree = {
    pick,
    menu: (root: FsRoot, entry: FsEntry | null, x: number, y: number) => {
      setSelected(keyOf(root.id, entry?.path ?? ""));
      setMenu({ x, y, root, entry });
    },
    commit: (v: string | null) => void commit(v),
    key: rowKey,
    dragStart: (root: FsRoot, entry: FsEntry, e: DragEvent) => {
      dragging.current = { rootId: root.id, path: entry.path };
      e.dataTransfer.setData(MOVE, keyOf(root.id, entry.path));
      e.dataTransfer.setData("text/plain", absolute(root, entry.path));
      e.dataTransfer.effectAllowed = "move";
    },
    dragOver: (root: FsRoot, entry: FsEntry | null, e: DragEvent) => {
      const dir = dropFolder(root, entry, e);
      if (dir === null) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = hasFiles(e.dataTransfer) ? "copy" : "move";
      setDropAt(keyOf(root.id, dir));
    },
    drop: (root: FsRoot, entry: FsEntry | null, e: DragEvent) => {
      const dir = dropFolder(root, entry, e);
      setDropAt(null);
      if (dir === null) return;
      e.preventDefault();
      e.stopPropagation();
      if (hasFiles(e.dataTransfer)) {
        void takeDrop(e.dataTransfer).then(({ items, more }) => addDropped(root, dir, items, more));
        return;
      }
      const src = dragging.current;
      dragging.current = null;
      if (src) void moveItem(root, src.path, joinPath(dir, baseName(src.path)));
    },
  };
  useEffect(() => {
    const end = () => { dragging.current = null; setDropAt(null); setMainDrop(false); };
    window.addEventListener("dragend", end);
    window.addEventListener("drop", end);
    return () => { window.removeEventListener("dragend", end); window.removeEventListener("drop", end); };
  }, []);

  // ---- the menu of a row ----
  const menuItems = (root: FsRoot, entry: FsEntry | null): (MenuItem | false | null)[][] => {
    const path = entry?.path ?? "";
    const kind = entry?.kind ?? "dir";
    const dir = folderFor(root, path, kind);
    const abs = absolute(root, path);
    return [
      [entry?.kind === "file" && { icon: <Eye size={14} />, label: "Open", run: () => void openFile(root, path, entry.bytes) }],
      kind === "dir" && dir !== null ? [
        { icon: <FilePlus size={14} />, label: "New file", run: () => void startNew("new-file", root, dir) },
        { icon: <FolderPlus size={14} />, label: "New folder", run: () => void startNew("new-folder", root, dir) },
        { icon: <Upload size={14} />, label: "Add files…", run: () => pickFiles(root, dir) },
      ] : [],
      [
        entry && changeable(root.id, path) && { icon: <Pencil size={14} />, label: "Rename", keys: "F2", run: () => setEditing({ kind: "rename", key: keyOf(root.id, path) }) },
        entry && changeable(root.id, path) && { icon: <Trash2 size={14} />, label: "Delete", keys: "⌘⌫", danger: true, run: () => void remove(root, entry) },
      ],
      [
        { icon: <MessageSquare size={14} />, label: kind === "dir" ? "Ask an agent about this folder" : "Ask an agent about this file", run: () => { setSelected(keyOf(root.id, path)); setTimeout(() => document.querySelector<HTMLInputElement>("[data-testid='files-ask']")?.focus(), 0); } },
        kind === "dir" && { icon: <Network size={14} />, label: "Show as a map", run: () => { if (path) openFolder(root, path); setMain({ kind: "map", rootId: root.id }); } },
        canReveal() && { icon: <FolderSearch size={14} />, label: revealLabel(), run: () => void revealFile(abs) },
        { icon: <Link size={14} />, label: "Copy path", run: () => void navigator.clipboard.writeText(abs).then(() => toast({ kind: "ok", text: "Path copied" })) },
        !entry && root.kind === "folder" && { icon: <X size={14} />, label: "Close this folder", run: () => void engine.closeFolder(root.id).then(loadRoots) },
      ],
    ];
  };

  // ---- the main area: drops anywhere on it go to the folder in view ----
  const onMainOver = (e: DragEvent) => {
    if (!hasFiles(e.dataTransfer) || !target || target.dir === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setMainDrop(true);
  };
  const onMainDrop = (e: DragEvent) => {
    setMainDrop(false);
    if (!hasFiles(e.dataTransfer) || !target || target.dir === null) return;
    e.preventDefault();
    const { root, dir } = target;
    void takeDrop(e.dataTransfer).then(({ items, more }) => addDropped(root, dir!, items, more));
  };

  // ---- asking an agent about what is open ----
  const about = async (): Promise<string | null> => {
    if (!here) return null;
    const abs = absolute(here.root, here.path);
    if (here.kind === "dir") {
      const l = listings[keyOf(here.root.id, here.path)] ?? (await engine.list(here.root.id, here.path).catch(() => null));
      return folderBrief(abs, l?.entries ?? [], l?.truncated ?? 0);
    }
    const d = docs.find((x) => x.key === selected);
    if (d) {
      const sel = d.key === active && main?.kind === "doc" && !d.page ? editor.current?.selection() : null;
      const text = sel?.text ?? editor.current?.value(d.key) ?? d.text;
      const where = sel ? `${abs}, lines ${sel.from}–${sel.to}` : abs;
      return `File: ${where}\n\n\`\`\`${editor.current?.language(d.key) ?? ""}\n${text.slice(0, 40_000)}\n\`\`\``;
    }
    return `File: ${abs}${here.entry ? ` (${shownAs(here.entry.name)}, ${here.entry.bytes} bytes)` : ""}\n(Open it with your file tools.)`;
  };

  const mapRoot = main?.kind === "map" ? rootOf(main.rootId) : null;
  const preview = main?.kind === "preview" ? { ...splitKey(main.key), m: main } : null;
  const previewRoot = preview ? rootOf(preview.rootId) : null;
  const showDoc = main?.kind === "doc" && !!doc;
  const cwd = target?.dir != null ? absolute(target.root, target.dir) : roots[0] ? absolute(roots[0], roots[0].kind === "profile" ? "workspace" : "") : null;
  const empty = !showDoc && !mapRoot && !(preview && previewRoot);

  return (
    <>
      <Sidebar title="Files" testId="files-sidebar" action={
        <button className="icon-btn sm" aria-label="New" data-tip="New file, folder, or add files" data-tip-side="bottom" data-dismiss-ignore
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAddMenu(addMenu ? null : { x: r.left, y: r.bottom + 6 }); }} data-testid="files-add"><Plus size={15} /></button>
      }>
        <div onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null); }}>
          <FileTree s={{ roots, listings, open, selected, dirty, editing, dropAt }} h={tree} />
        </div>
        <button className="tree-row root faint" onClick={() => useApp.getState().setFolderPickerOpen(true)} data-testid="open-folder-row"><FolderInput size={13} /><span>Open a folder…</span></button>
      </Sidebar>
      <section className={`main code-main files-main${mainDrop ? " dropping" : ""}`} data-saves={canSave ? "true" : undefined}
        onDragOver={onMainOver} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setMainDrop(false); }} onDrop={onMainDrop} data-testid="files-view">
        <div className="code-tabs" role="tablist">
          {docs.map((d) => (
            <div key={d.key} role="tab" aria-selected={showDoc && d.key === active} className="code-tab" onClick={() => { setActive(d.key); setSelected(d.key); setMain({ kind: "doc" }); }} data-tip={d.readOnly ? "Read only: McBot writes this file" : undefined}>
              {d.readOnly && <FileLock size={11} />}
              <span className="ellipsis">{baseName(d.path)}</span>
              {dirty.has(d.key) ? <span className="dot" /> : null}
              <button className="icon-btn sm" aria-label={`Close ${baseName(d.path)}`} onClick={(e) => { e.stopPropagation(); closeDoc(d.key); }}><X size={11} /></button>
            </div>
          ))}
          <span className="grow" />
          {showDoc && readsAsPage(doc.path) && (
            <button className="btn sm ghost" onClick={() => setDocs((all) => all.map((x) => (x.key === doc.key ? { ...x, page: !x.page } : x)))} data-testid="files-page-toggle">
              {doc.page ? <><Pencil size={12} /> Edit</> : <><Eye size={12} /> Preview</>}
            </button>
          )}
          {canSave && <button className="btn sm ghost" disabled={!dirty.has(doc.key)} onClick={() => void save()} data-tip="⌘S"><Save size={12} /> Save</button>}
          <button className="icon-btn sm" aria-pressed={!!mapRoot} aria-label="Map" data-tip="See the folder as a map" disabled={!here && !mapRoot}
            onClick={() => (mapRoot ? setMain(doc ? { kind: "doc" } : null) : here && setMain({ kind: "map", rootId: here.root.id }))} data-testid="files-map"><Network size={14} /></button>
          <button className="icon-btn sm" aria-pressed={terminal} aria-label="Terminal" data-tip="Terminal  ⌃`" onClick={() => setTerminal(!terminal)} data-testid="terminal-toggle"><PanelBottom size={14} /></button>
        </div>
        <div className={`code-body${terminal ? " with-terminal" : ""}`}>
          <div className="code-editor">
            {docs.length > 0 && (
              <div className="files-layer" hidden={!showDoc || doc.page}>
                <Suspense fallback={<div className="files-wait"><SkeletonCards count={3} /></div>}>
                  <CodeEditor ref={editor} docs={docs} active={active} drafts={session.drafts}
                    onDirty={(key, d) => setDirty((s) => { if (s.has(key) === d) return s; const n = new Set(s); if (d) n.add(key); else n.delete(key); return n; })} />
                </Suspense>
              </div>
            )}
            {showDoc && doc.page && (
              <div className="files-layer files-page" data-testid="files-page">
                <article className="file-page"><RichText text={editor.current?.value(doc.key) ?? session.drafts.get(doc.key) ?? doc.text} /></article>
              </div>
            )}
            {preview && previewRoot && <div className="files-layer"><Preview root={previewRoot} path={preview.path} shown={preview.m.shown} size={preview.m.size} reason={preview.m.reason} /></div>}
            {mapRoot && (
              <div className="files-layer">
                <FolderMap root={mapRoot} listings={listings} open={open} selected={selected && splitKey(selected).rootId === mapRoot.id ? splitKey(selected).path : null}
                  onToggle={(p) => pick(mapRoot, listings[keyOf(mapRoot.id, parentOf(p))]?.entries.find((e) => e.path === p) ?? { name: baseName(p), path: p, kind: "dir", bytes: 0, children: null, owned: false })}
                  onFile={(p) => void openFile(mapRoot, p)} />
              </div>
            )}
            {empty && (
              <div className="files-layer">
                {roots.length === 0 ? <SkeletonCards count={3} /> : (
                  <Empty title={target?.dir != null ? `Drop files into ${target.dir ? baseName(target.dir) : target.root.name}` : "Pick a file"}
                    action={target?.dir != null ? <button className="btn light" onClick={() => pickFiles(target.root, target.dir!)}><Upload size={13} /> Add files</button>
                      : <button className="btn light" onClick={() => useApp.getState().setFolderPickerOpen(true)}><FolderInput size={13} /> Open a folder</button>}>
                    {target?.dir != null ? "Or pick a file on the left." : "Or open a folder from your computer."}
                  </Empty>
                )}
              </div>
            )}
            {mainDrop && target?.dir != null && <div className="files-drop" aria-hidden="true"><Upload size={22} /><span>Add to {target.dir ? baseName(target.dir) : target.root.name}</span></div>}
          </div>
          {here && (
            <AskBar about={about} testId="files-ask"
              placeholder={here.kind === "dir" ? "Ask about this folder: what's in it, sort it, write a summary…" : showDoc && !doc.page ? "Ask about this file or the selection: explain, fix, rewrite…" : "Ask about this file: summarize it, check it, turn it into…"} />
          )}
          {terminal && cwd && (
            <div className="code-terminal">
              <Suspense fallback={null}><TerminalPanel key={cwd} cwd={cwd} /></Suspense>
            </div>
          )}
        </div>
      </section>
      <input ref={picker} type="file" multiple hidden onChange={(e) => {
        const files = [...(e.currentTarget.files ?? [])];
        e.currentTarget.value = "";
        const to = pickTo.current;
        if (to && files.length) void addDropped(to.root, to.dir, files.map((file) => ({ dir: "", file })));
      }} />
      {menu && <RowMenu x={menu.x} y={menu.y} groups={menuItems(menu.root, menu.entry)} onClose={() => setMenu(null)} />}
      {addMenu && (
        <RowMenu x={addMenu.x} y={addMenu.y} onClose={() => setAddMenu(null)} groups={[
          target?.dir != null ? [
            { icon: <FilePlus size={14} />, label: "New file", run: () => void startNew("new-file", target.root, target.dir!) },
            { icon: <FolderPlus size={14} />, label: "New folder", run: () => void startNew("new-folder", target.root, target.dir!) },
            { icon: <Upload size={14} />, label: "Add files…", run: () => pickFiles(target.root, target.dir!) },
          ] : [],
          [{ icon: <FolderInput size={14} />, label: "Open a folder…", run: () => useApp.getState().setFolderPickerOpen(true) }],
        ]} />
      )}
    </>
  );
}
