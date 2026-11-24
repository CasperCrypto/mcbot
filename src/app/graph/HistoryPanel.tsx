/**
 * The harness over time (src/harness/versions.ts): every compile that changed it is a version, with
 * what changed in words and how its runs went. Pick two to compare them side by side (success, cost,
 * time, tokens per run, and what differs); name one; restore one (one ⌘Z takes it back).
 */
import { GitCompareArrows, History, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { restoreHarness } from "../../board/ydoc";
import { describeChanges, versionStats, type HarnessVersion, type VersionStats } from "../../harness/versions";
import { engine, REMOTE } from "../lib/engine";
import { ago, duration, tokens as fmtTokens, usd } from "../lib/format";
import { useDismiss } from "../lib/presence";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";

const when = (at: number) => {
  const d = new Date(at);
  return Date.now() - at < 86_400_000 ? ago(at) : d.toLocaleDateString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};
const pct = (s: VersionStats) => (s.runs ? `${Math.round((s.succeeded / s.runs) * 100)}%` : "—");

/** One measure, A → B, with the direction that is better marked. */
function Delta({ label, a, b, fmt, lowerIsBetter, neutral }: { label: string; a: number | null; b: number | null; fmt: (n: number) => string; lowerIsBetter?: boolean; neutral?: boolean }) {
  const diff = a !== null && b !== null && a !== 0 && !neutral ? (b - a) / Math.abs(a) : null;
  const better = diff === null || Math.abs(diff) < 0.02 ? null : lowerIsBetter ? diff < 0 : diff > 0;
  return (
    <div className="cmp-row">
      <span className="cmp-label">{label}</span>
      <span className="num">{a === null ? "—" : fmt(a)}</span>
      <span className="cmp-arrow">→</span>
      <span className="num">{b === null ? "—" : fmt(b)}</span>
      <span className={`cmp-delta num${better === null ? "" : better ? " good" : " bad"}`}>{diff === null || Math.abs(diff) < 0.02 ? "" : `${diff > 0 ? "+" : ""}${Math.round(diff * 100)}%`}</span>
    </div>
  );
}

export function HistoryPanel({ onClose, closing = false }: { onClose: () => void; closing?: boolean }) {
  const { boardId, doc } = useBoard();
  const runs = useApp((s) => s.runs);
  const drift = useApp((s) => s.drift);
  const [versions, setVersions] = useState<HarnessVersion[] | null>(null);
  const [pick, setPick] = useState<string[]>([]);
  const [naming, setNaming] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  useDismiss(!closing, onClose, panel, { outside: false });

  // Read again after every compile (drift changes when one lands).
  useEffect(() => {
    let live = true;
    engine.versions(boardId).then((r) => { if (live) setVersions(r.versions); }).catch(() => { if (live) setVersions([]); });
    return () => { live = false; };
  }, [boardId, drift]);

  const list = useMemo(() => [...(versions ?? [])].reverse(), [versions]);
  const stats = useMemo(() => versionStats(versions ?? [], Object.values(runs)), [versions, runs]);
  const [aId, bId] = [...pick].sort((x, y) => (versions?.findIndex((v) => v.id === x) ?? 0) - (versions?.findIndex((v) => v.id === y) ?? 0));
  const A = versions?.find((v) => v.id === aId);
  const B = versions?.find((v) => v.id === bId);
  const toggle = (id: string) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.slice(-1), id]));
  const rename = async (v: HarnessVersion, name: string) => {
    setNaming(null);
    if ((v.name ?? "") === name.trim()) return;
    try {
      setVersions((await engine.nameVersion(boardId, v.id, name)).versions);
    } catch (e) {
      useApp.getState().toast({ kind: "fail", text: (e as Error).message });
    }
  };
  const restore = (v: HarnessVersion) => {
    if (confirm !== v.id) return setConfirm(v.id);
    setConfirm(null);
    restoreHarness(doc, v.graph);
    useApp.getState().toast({ kind: "ok", text: `Back to the version from ${when(v.at)}. Compile to use it.` });
  };

  return (
    <aside ref={panel} className="live-files history glass" data-closing={closing || undefined} aria-label="Harness history" data-testid="history">
      <div className="sheet-head">
        <History size={14} className="faint" />
        <b className="grow">History</b>
        <span className="faint" style={{ fontSize: 12 }}>{versions ? `${versions.length} version${versions.length === 1 ? "" : "s"}` : ""}</span>
        <button className="icon-btn sm" aria-label="Close" onClick={onClose}><X size={14} /></button>
      </div>
      <div className="history-body">
        {A && B && (
          <section className="cmp-card" data-testid="history-compare">
            <div className="cmp-head"><GitCompareArrows size={13} /><b>{A.name || when(A.at)}</b><span className="faint">→</span><b>{B.name || when(B.at)}</b></div>
            {(() => {
              const sa = stats.get(A.id)!;
              const sb = stats.get(B.id)!;
              return (
                <div className="cmp-grid">
                  <Delta label="Runs" a={sa.runs} b={sb.runs} fmt={(n) => String(n)} neutral />
                  <Delta label="Succeeded" a={sa.runs ? sa.succeeded / sa.runs : null} b={sb.runs ? sb.succeeded / sb.runs : null} fmt={(n) => `${Math.round(n * 100)}%`} />
                  <Delta label="Cost per run" a={sa.usdPerRun} b={sb.usdPerRun} fmt={usd} lowerIsBetter />
                  <Delta label="Time per run" a={sa.msPerRun} b={sb.msPerRun} fmt={duration} lowerIsBetter />
                  <Delta label="Tokens per run" a={sa.tokensPerRun} b={sb.tokensPerRun} fmt={fmtTokens} lowerIsBetter />
                </div>
              );
            })()}
            <ul className="cmp-changes">{describeChanges(A.graph, B.graph).map((c) => <li key={c}>{c}</li>)}</ul>
          </section>
        )}
        {versions === null ? <div className="skeleton" style={{ height: 120 }} /> : list.length === 0 ? (
          <p className="history-empty">Each compile that changes the harness is kept here, with how its runs went.</p>
        ) : list.map((v, i) => {
          const s = stats.get(v.id)!;
          return (
            <article key={v.id} className="ver" data-picked={pick.includes(v.id) || undefined} data-testid="history-version">
              <div className="ver-head">
                <span className={`ver-dot${i === 0 ? " now" : ""}`} />
                {naming === v.id ? (
                  <input className="ver-name-input" autoFocus defaultValue={v.name ?? ""} placeholder="Name this version" maxLength={80}
                    onBlur={(e) => void rename(v, e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setNaming(null); }} />
                ) : (
                  <button className="ver-name" onClick={() => !REMOTE && setNaming(v.id)} data-tip={REMOTE ? undefined : "Name it"}>{v.name || (i === 0 ? "Live now" : when(v.at))}</button>
                )}
                <span className="faint ver-when">{v.name || i === 0 ? when(v.at) : ""}</span>
              </div>
              <ul className="ver-changes">
                {v.changes.slice(0, 3).map((c) => <li key={c}>{c}</li>)}
                {v.changes.length > 3 && <li className="faint">and {v.changes.length - 3} more</li>}
              </ul>
              <div className="ver-stats">
                <span data-tip="Runs started while this was live">{s.runs} run{s.runs === 1 ? "" : "s"}</span>
                <span data-tip="Succeeded">{pct(s)}</span>
                <span data-tip="Cost per run">{s.usdPerRun === null ? "—" : usd(s.usdPerRun)}</span>
                <span data-tip="Time per run">{s.msPerRun === null ? "—" : duration(s.msPerRun)}</span>
              </div>
              <div className="ver-actions">
                <button className={`btn sm${pick.includes(v.id) ? " primary" : ""}`} onClick={() => toggle(v.id)} data-testid="history-pick"><GitCompareArrows size={12} /> {pick.includes(v.id) ? "Comparing" : "Compare"}</button>
                {i > 0 && !REMOTE && <button className="btn sm ghost" onClick={() => restore(v)} onBlur={() => setConfirm(null)}><RotateCcw size={12} /> {confirm === v.id ? "Sure?" : "Restore"}</button>}
              </div>
            </article>
          );
        })}
      </div>
    </aside>
  );
}
