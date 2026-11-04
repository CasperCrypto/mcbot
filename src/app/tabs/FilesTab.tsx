import { FileText, Folder, FolderOpen } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FileEntry } from "../../contracts/api";
import { bytes } from "../lib/format";
import { engine } from "../lib/engine";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { Empty } from "../ui";

type Listing = { profile: string; nodeId: string; files: FileEntry[] }[];

export function FilesTab() {
  const { boardId } = useBoard();
  const compile = useApp((s) => s.compile);
  const runs = useApp((s) => s.runs);
  const [listing, setListing] = useState<Listing | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [path, setPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ text: string | null; reason?: string; bytes: number } | null>(null);
  const finished = Object.values(runs).filter((r) => r.status !== "running").length;

  useEffect(() => {
    engine.files(boardId).then((l) => {
      setListing(l);
      setOpen((prev) => (prev.size ? prev : new Set(l.map((p) => `profiles/${p.profile}`).concat(l.map((p) => `profiles/${p.profile}/skills`), l.map((p) => `profiles/${p.profile}/memories`)))));
    }).catch(() => setListing([]));
  }, [boardId, compile, finished]);

  useEffect(() => {
    if (!path) return setPreview(null);
    engine.file(path).then(setPreview).catch((e) => setPreview({ text: null, reason: (e as Error).message, bytes: 0 }));
  }, [path]);

  const rows = useMemo(() => {
    if (!listing) return [];
    return listing.flatMap((p) => {
      const root = `profiles/${p.profile}`;
      const visible = p.files.filter((f) => {
        const parts = f.path.slice(root.length + 1).split("/");
        for (let i = 1; i < parts.length; i++) if (!open.has(`${root}/${parts.slice(0, i).join("/")}`)) return false;
        return open.has(root);
      });
      return [{ group: p.profile, root, empty: p.files.length === 0 }, ...visible.map((f) => ({ file: f, depth: f.path.slice(root.length + 1).split("/").length }))];
    });
  }, [listing, open]);

  if (listing && !listing.length) return <div className="page"><Empty icon={<FolderOpen size={28} />} title="No agents on this board">Each agent's Hermes profile directory appears here after you compile.</Empty></div>;

  const toggle = (p: string) => setOpen((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });

  return (
    <div className="split" style={{ gridTemplateColumns: "380px 1fr" }}>
      <div className="list tree" aria-label="Files" data-testid="file-tree">
        {rows.map((r) => "group" in r ? (
          <div key={r.root}>
            <div className="tree-group">{r.group.toUpperCase()}</div>
            {r.empty ? <div className="faint" style={{ padding: "2px 16px 8px", fontSize: 12 }}>Not compiled yet.</div> : (
              <div className="tree-row" style={{ paddingLeft: 12 }} onClick={() => toggle(r.root)}>
                {open.has(r.root) ? <FolderOpen size={14} className="faint" /> : <Folder size={14} className="faint" />}<span className="name mono">{r.root}</span>
              </div>
            )}
          </div>
        ) : (
          <div key={r.file.path} className="tree-row" style={{ paddingLeft: 12 + r.depth * 16 }} aria-selected={path === r.file.path}
            onClick={() => (r.file.kind === "dir" ? toggle(r.file.path) : setPath(r.file.path))}>
            {r.file.kind === "dir" ? (open.has(r.file.path) ? <FolderOpen size={14} className="faint" /> : <Folder size={14} className="faint" />) : <FileText size={14} className="faint" />}
            <span className="name">{r.file.path.split("/").pop()}</span>
            {r.file.kind === "file" && r.file.owner === "mcbot" && <span className="badge agent" title="Written by the compiler">compiled</span>}
            {r.file.kind === "file" && <span className="size num">{bytes(r.file.bytes)}</span>}
          </div>
        ))}
      </div>
      <div className="detail">
        {path ? (
          <>
            <div className="row" style={{ marginBottom: 12 }}><b className="mono">{path}</b><span className="faint">{preview ? bytes(preview.bytes) : ""}</span></div>
            {preview?.text !== null && preview?.text !== undefined ? <pre className="preview card" style={{ padding: 14 }}>{preview.text || " "}</pre> : <span className="faint">{preview?.reason ?? "Loading…"}</span>}
          </>
        ) : (
          <Empty icon={<FileText size={28} />} title="Select a file">Files marked <span className="badge agent">compiled</span> are owned by McBot and rewritten on compile. Everything else is written by Hermes at runtime and never touched.</Empty>
        )}
      </div>
    </div>
  );
}
