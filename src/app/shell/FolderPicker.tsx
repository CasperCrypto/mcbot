/**
 * Open a folder without typing its path: places on the left (Home, Desktop, Documents…), the
 * folders inside the current one on the right, a path field for pasting. The engine lists folder
 * names only (GET /api/fs/browse); opening adds the folder to Files and Code.
 */
import { ArrowUp, ChevronRight, Folder, FolderOpen, House, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { FsBrowse } from "../../contracts/api";
import { engine } from "../lib/engine";
import { useApp } from "../state/store";

const LAST = "mcbot.picker.last";
const lastPath = () => {
  try {
    return localStorage.getItem(LAST);
  } catch {
    return null;
  }
};

export function FolderPicker() {
  const open = useApp((s) => s.folderPickerOpen);
  const setOpen = useApp((s) => s.setFolderPickerOpen);
  const [at, setAt] = useState<FsBrowse | null>(null);
  const [typed, setTyped] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async (path: string | null) => {
    setProblem(null);
    try {
      const b = await engine.browse(path);
      setAt(b);
      setTyped(b.path);
    } catch (err) {
      setProblem((err as Error).message);
    }
  };
  useEffect(() => {
    if (!open) return;
    setAt(null);
    setProblem(null);
    // Where the last folder was opened from; home when that is gone.
    void engine.browse(lastPath()).catch(() => engine.browse(null)).then((b) => { setAt(b); setTyped(b.path); }).catch((err: Error) => setProblem(err.message));
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;

  const choose = async (path: string) => {
    setBusy(true);
    try {
      const root = await engine.openFolder(path);
      try {
        localStorage.setItem(LAST, at?.parent && path === at.path ? at.parent : at?.path ?? path);
      } catch {
        /* remembered for this session only */
      }
      const app = useApp.getState();
      app.folderOpened(root.id);
      if (app.tab !== "files" && app.tab !== "code") app.setTab("files");
      app.toast({ kind: "ok", text: `Opened ${root.name}` });
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const crumbs = at ? at.path.split(/[\\/]/).filter(Boolean) : [];
  const sep = at?.path.includes("\\") ? "\\" : "/";
  const crumbPath = (i: number) => {
    const head = at!.path.match(/^[A-Za-z]:\\/) ? "" : "/";
    return head + crumbs.slice(0, i + 1).join(sep) + (/^[A-Za-z]:$/.test(crumbs[0] ?? "") && i === 0 ? sep : "");
  };

  return (
    <>
      <div className="palette-scrim" onClick={() => setOpen(false)} />
      <section className="palette hermes-sheet picker" role="dialog" aria-label="Open a folder" data-testid="folder-picker">
        <header>
          <span className="hermes-mark" aria-hidden><FolderOpen size={18} /></span>
          <div className="grow"><h2>Open a folder</h2><small>Agents and the editor can work in it</small></div>
          <button className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}><X size={15} /></button>
        </header>
        <div className="picker-body">
          <nav className="picker-places" aria-label="Places">
            {(at?.places ?? []).map((p) => (
              <button key={p.path} className="list-row" aria-selected={at?.path === p.path} onClick={() => void go(p.path)}>
                {p.name === "Home" ? <House size={13} /> : <Folder size={13} />}<span className="ellipsis">{p.name}</span>
              </button>
            ))}
          </nav>
          <div className="picker-main">
            <div className="picker-path">
              <button className="icon-btn sm" aria-label="Up" data-tip="Up" disabled={!at?.parent} onClick={() => at?.parent && void go(at.parent)}><ArrowUp size={13} /></button>
              <input className="mono" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="~/Documents" aria-label="Path" data-testid="picker-path"
                onKeyDown={(e) => { if (e.key === "Enter" && typed.trim()) void go(typed.trim()); }} />
            </div>
            <div className="picker-crumbs faint">
              {crumbs.map((c, i) => (
                <span key={i} className="row" style={{ gap: 2 }}>
                  {i > 0 && <ChevronRight size={11} />}
                  <button className="link-btn" onClick={() => void go(crumbPath(i))}>{c}</button>
                </span>
              ))}
            </div>
            <div className="picker-list" data-testid="picker-list">
              {!at && !problem ? <div className="faint row" style={{ padding: 12 }}><LoaderCircle size={14} className="spin-icon" /> Loading…</div>
                : at && at.dirs.length === 0 ? <div className="faint" style={{ padding: 12 }}>No folders inside</div>
                : at?.dirs.map((d) => (
                  <button key={d.path} className="list-row" onClick={() => void go(d.path)} onDoubleClick={() => void choose(d.path)} data-testid="picker-dir">
                    <Folder size={13} className="folder-ink" /><span className="grow ellipsis">{d.name}</span><ChevronRight size={13} className="faint" />
                  </button>
                ))}
            </div>
            {problem && <span className="error" style={{ fontSize: 12 }}>{problem}</span>}
          </div>
        </div>
        <footer className="picker-foot">
          <span className="grow mono ellipsis faint" style={{ fontSize: 12 }}>{at?.path}</span>
          <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn primary" disabled={!at || busy} onClick={() => at && void choose(at.path)} data-testid="picker-open">
            Open {at ? (crumbs.at(-1) ?? at.path) : ""}
          </button>
        </footer>
      </section>
    </>
  );
}
