/**
 * Live files: what Compile would write, while you draw. Every board edit asks the engine for a
 * dry-run compile (`GET /api/compile`, the real compiler and the real writer, config.yaml merged
 * into the one on disk) and shows each file whole, its changes against disk marked. Nothing is
 * written until Compile. Selecting a block opens the file it changes.
 */
import { FileCode2, Hammer, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDismiss } from "../lib/presence";
import type { CompileResponse } from "../../contracts/api";
import type { FileChange } from "../../contracts/compile";
import { compileBoard } from "../actions";
import { engine } from "../lib/engine";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { afterText, diskPath, fileLines } from "./filePreview";

const MARK: Record<FileChange["status"], string> = { added: "A", modified: "M", removed: "D", unchanged: "" };

function useLivePreview(open: boolean): CompileResponse | null {
  const { graph, boardId } = useBoard();
  const compiled = useApp((s) => s.compile);
  const [res, setRes] = useState<CompileResponse | null>(null);
  // Positions don't change any file: a drag must not re-run the preview.
  const content = useMemo(() => JSON.stringify({ n: graph.nodes.map((n) => [n.id, n.kind, n.data]), e: graph.edges }), [graph]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    // The board reaches the engine's copy within a moment; ask after the edit settles, then once more.
    const ask = () => engine.preview(boardId).then((r) => { if (live) setRes(r); }).catch(() => undefined);
    const a = setTimeout(ask, 250);
    const b = setTimeout(ask, 1200);
    return () => { live = false; clearTimeout(a); clearTimeout(b); };
  }, [open, boardId, content, compiled]);
  return res;
}

export function LiveFiles({ onClose }: { onClose: () => void }) {
  const { graph, boardId } = useBoard();
  const selectedNodeId = useApp((s) => s.selectedNodeId);
  const busy = useApp((s) => s.compileBusy);
  const res = useLivePreview(true);
  const changes = useMemo(() => (res?.ok ? res.report.changes.filter((c) => c.role !== "manifest") : []), [res]);
  const [path, setPath] = useState<string | null>(null);
  const [disk, setDisk] = useState<Record<string, string | null>>({});
  const pinned = useRef(false);
  // A working panel: it stays open while you edit the board, and Esc puts it away.
  const panel = useRef<HTMLElement>(null);
  useDismiss(true, onClose, panel, { outside: false });

  // A selected block opens the file it changes: its agent's config.yaml (a model, tool, maker or
  // chat app: the first agent it is wired to).
  useEffect(() => {
    if (!selectedNodeId) return;
    const node = graph.nodes.find((n) => n.id === selectedNodeId);
    if (!node) return;
    const agentId = node.kind === "agent" ? node.id
      : graph.edges.map((e) => (e.source === node.id ? e.target : e.target === node.id ? e.source : null)).find((id) => graph.nodes.some((n) => n.id === id && n.kind === "agent")) ?? null;
    const agent = graph.nodes.find((n) => n.id === agentId);
    if (agent) { setPath(`profiles/${agent.data.name}/config.yaml`); pinned.current = false; }
  }, [selectedNodeId, graph]);
  // Otherwise the first changed file.
  useEffect(() => {
    if (path && changes.some((c) => c.path === path)) return;
    if (pinned.current && path) return;
    const first = changes.find((c) => c.status !== "unchanged" && c.role === "config") ?? changes.find((c) => c.status !== "unchanged") ?? changes[0];
    setPath(first?.path ?? null);
  }, [changes]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = changes.find((c) => c.path === path) ?? null;
  // What is on disk for the selected file, read again after every preview (a compile or the CLI may have changed it).
  useEffect(() => {
    if (!selected) return;
    const at = diskPath(selected.path);
    if (!at || selected.status === "added") { setDisk((d) => ({ ...d, [selected.path]: "" })); return; }
    let live = true;
    engine.read(at.root, at.rel).then((f) => { if (live) setDisk((d) => ({ ...d, [selected.path]: f.text ?? "" })); }).catch(() => { if (live) setDisk((d) => ({ ...d, [selected.path]: null })); });
    return () => { live = false; };
  }, [selected?.path, selected?.previousSha256, res]); // eslint-disable-line react-hooks/exhaustive-deps

  const before = selected ? disk[selected.path] : undefined;
  const after = selected && typeof before === "string" ? afterText(before, selected) : null;
  const lines = selected && typeof before === "string" && after !== null ? fileLines(before, after) : null;
  const changed = changes.filter((c) => c.status !== "unchanged").length;
  const errors = res && !res.ok ? res.issues.filter((i) => i.level === "error") : [];

  return (
    <section ref={panel} className="live-files glass" aria-label="Live files" data-testid="live-files">
      <div className="sheet-head">
        <FileCode2 size={14} />
        <h3>Files</h3>
        <span className="faint">{!res ? "…" : !res.ok ? "can't compile yet" : changed ? `${changed} will change` : "same as on disk"}</span>
        <span className="grow" />
        {changed > 0 && <button className="btn sm primary" disabled={busy} onClick={() => void compileBoard(boardId)} data-tip="⌘S"><Hammer size={12} /> Compile</button>}
        <button className="icon-btn sm" aria-label="Close" onClick={onClose}><X size={14} /></button>
      </div>
      {errors.length > 0 && (
        <div className="live-issues">
          {errors.map((i, n) => <button key={n} className="issue" onClick={() => i.nodeId && useApp.getState().select(i.nodeId)}>{i.message}</button>)}
        </div>
      )}
      <div className="live-list" role="listbox" aria-label="Files">
        {changes.map((c) => (
          <div key={c.path} role="option" aria-selected={c.path === path} className="file-row" onClick={() => { setPath(c.path); pinned.current = true; }} data-testid="live-file">
            <span className={`status-mark ${c.status}`}>{MARK[c.status]}</span>
            <span className="path" title={c.path}>{c.path.replace(/^profiles\//, "")}</span>
          </div>
        ))}
      </div>
      <div className="live-body mono" data-testid="live-content">
        {!selected ? null : before === null ? <div className="faint">Can't read it from disk.</div> : !lines ? <div className="faint">…</div> : (
          lines.map((l, i) => <div key={i} className={`ln ${l.kind}`}><span className="sign">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>{l.text || " "}</div>)
        )}
      </div>
    </section>
  );
}
