import { Check, CircleAlert, Copy, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { FileChange } from "../../contracts/compile";
import { bytes } from "../lib/format";
import { useApp } from "../state/store";

const MARK: Record<FileChange["status"], string> = { added: "A", modified: "M", removed: "D", unchanged: "=" };

function Diff({ change }: { change: FileChange }) {
  if (change.status === "unchanged") return <div className="diff"><div className="meta">  unchanged · sha256 {change.sha256}</div></div>;
  return (
    <div className="diff" data-testid="diff">
      {change.diff.split("\n").slice(2).map((l, i) => (
        <div key={i} className={l.startsWith("+++") || l.startsWith("---") ? "meta" : l.startsWith("@@") ? "hunk" : l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : ""}>{l || " "}</div>
      ))}
    </div>
  );
}

function CopyCommand({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="btn sm" data-tip={text} data-tip-side="bottom" onClick={() => void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); })}>
      {done ? <Check size={13} /> : <Copy size={13} />} <span className="mono">{label}</span>
    </button>
  );
}

export function CompileSheet({ wide }: { wide: boolean }) {
  const res = useApp((s) => s.compile);
  const setCompile = useApp((s) => s.setCompile);
  const select = useApp((s) => s.select);
  const [path, setPath] = useState<string | null>(null);
  const changes = res?.ok ? res.report.changes : [];

  useEffect(() => {
    if (changes.some((c) => c.path === path)) return;
    const changed = changes.filter((c) => c.status !== "unchanged");
    setPath((changed.find((c) => c.path.endsWith("/config.yaml")) ?? changed.find((c) => c.role !== "manifest") ?? changes[0])?.path ?? null);
  }, [res]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!res) return null;
  const selected = changes.find((c) => c.path === path) ?? null;
  const changedCount = changes.filter((c) => c.status !== "unchanged").length;

  return (
    <section className={`sheet glass${wide ? " wide" : ""}`} aria-label="Compile output" data-testid="compile-sheet">
      <div className="sheet-head">
        <h3>{res.ok ? `${changes.length} files` : "Can't compile yet"}</h3>
        {res.ok && <span className="faint">{changedCount ? `${changedCount} changed` : "up to date"}</span>}
        <span className="grow" />
        <button className="icon-btn" aria-label="Close" onClick={() => setCompile({ compileOpen: false })}><X size={16} /></button>
      </div>
      {res.ok ? (
        <div className="sheet-body">
          <div className="file-list" role="listbox" aria-label="Files">
            {changes.map((c) => (
              <div key={c.path} role="option" className="file-row" aria-selected={c.path === path} onClick={() => setPath(c.path)} data-testid="compiled-file">
                <span className={`status-mark ${c.status}`} title={c.status}>{MARK[c.status]}</span>
                <span className="path" title={c.path}>{c.path}</span>
                <span className="hash" title={`sha256 ${c.sha256 ?? c.previousSha256}`}>{(c.sha256 ?? c.previousSha256 ?? "").slice(0, 8)} · {bytes(c.bytes)}</span>
              </div>
            ))}
          </div>
          {selected ? <Diff change={selected} /> : <div />}
        </div>
      ) : (
        <div style={{ overflow: "auto", padding: 14, display: "grid", gap: 6, alignContent: "start" }}>
          {res.issues.filter((i) => i.level === "error").map((i, n) => (
            <button key={n} className="issue" style={{ border: 0, textAlign: "left" }} onClick={() => i.nodeId && select(i.nodeId)}>
              <CircleAlert size={14} style={{ flex: "none", marginTop: 1 }} />
              <span>{i.message}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
