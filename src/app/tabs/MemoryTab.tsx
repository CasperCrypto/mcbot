import { Brain, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AgentMemoryView, MemoryFileView } from "../../contracts/api";
import { engine } from "../lib/engine";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { Empty } from "../ui";

const LABEL = { memory: { file: "MEMORY.md", title: "What the agent has learned" }, user: { file: "USER.md", title: "Who its users are" } } as const;

function MemoryFile({ profile, file, busy, onSaved }: { profile: string; file: MemoryFileView; busy: boolean; onSaved: (f: MemoryFileView) => void }) {
  const toast = useApp((s) => s.toast);
  const [draft, setDraft] = useState<string[]>(file.entries);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(file.entries), [file.sha256]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = JSON.stringify(draft.map((d) => d.trim()).filter(Boolean)) !== JSON.stringify(file.entries);
  const chars = [...draft.map((d) => d.trim()).filter(Boolean).join("\n§\n")].length;
  const pct = Math.min(100, (chars / file.limit) * 100);

  const save = async () => {
    setSaving(true);
    try {
      onSaved(await engine.saveMemory(profile, file.target, draft, file.sha256));
      toast({ kind: "ok", text: `Saved ${profile}/${LABEL[file.target].file}` });
    } catch (err) {
      toast({ kind: "fail", text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mem-file" data-testid={`memory-${file.target}`}>
      <div className="row">
        <b>{LABEL[file.target].file}</b>
        <span className="faint">{LABEL[file.target].title}</span>
        <span style={{ flex: 1 }} />
        <span className="faint num" style={{ fontSize: 11 }}>{chars} / {file.limit} chars</span>
      </div>
      <div className={`meter${pct > 85 ? " hot" : ""}`}><i style={{ width: `${pct}%` }} /></div>
      {draft.length === 0 && <span className="faint" style={{ fontSize: 12 }}>{file.exists ? "Empty." : "Nothing yet. Hermes writes here with its memory tool during runs."}</span>}
      {draft.map((entry, i) => (
        <div key={i} className="entry">
          <textarea value={entry} rows={Math.max(1, Math.ceil(entry.length / 70))} onChange={(e) => setDraft(draft.map((d, n) => (n === i ? e.target.value : d)))} aria-label={`Entry ${i + 1}`} />
          <button className="icon-btn" title="Delete entry" aria-label="Delete entry" onClick={() => setDraft(draft.filter((_, n) => n !== i))}><Trash2 size={13} /></button>
        </div>
      ))}
      <div className="row">
        <button className="btn sm" onClick={() => setDraft([...draft, ""])}><Plus size={12} /> Entry</button>
        <span style={{ flex: 1 }} />
        {dirty && <button className="btn ghost sm" onClick={() => setDraft(file.entries)}>Revert</button>}
        <button className="btn primary sm" disabled={!dirty || saving || busy || chars > file.limit} onClick={save} title={busy ? "This agent is running" : undefined}>Save</button>
      </div>
    </div>
  );
}

export function MemoryTab() {
  const { boardId } = useBoard();
  const runs = useApp((s) => s.runs);
  const [agents, setAgents] = useState<AgentMemoryView[] | null>(null);
  const finished = Object.values(runs).filter((r) => r.status !== "running").length;

  const load = useCallback(() => engine.memory(boardId).then(setAgents).catch(() => setAgents([])), [boardId]);
  useEffect(() => {
    void load();
  }, [load, finished]);

  if (agents === null) return <div className="page" />;
  if (!agents.length) return <div className="page"><Empty icon={<Brain size={28} />} title="No agents on this board">Each agent's memory lives in its Hermes profile: memories/MEMORY.md and memories/USER.md.</Empty></div>;

  const update = (profile: string, f: MemoryFileView) => setAgents((prev) => prev?.map((a) => (a.profile === profile ? { ...a, [f.target]: f } : a)) ?? prev);

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 14 }}>
        <span className="muted">The agent writes these with Hermes' <code>memory</code> tool; they are injected into its system prompt at the start of every session. Edits apply from the next run.</span>
        <span style={{ flex: 1 }} />
        <button className="btn sm" onClick={() => void load()}><RefreshCw size={12} /> Reload</button>
      </div>
      <div className="mem-grid">
        {agents.map((a) => (
          <div key={a.profile} className="card" data-testid="memory-card">
            <div className="card-head">
              <div className="node-glyph agent"><Brain size={14} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3>{a.displayName}</h3>
                <div className="faint mono" style={{ fontSize: 11 }}>profiles/{a.profile}/memories/</div>
              </div>
              {a.busy && <span className="badge run">running</span>}
              {!a.compiled && <span className="badge warn">not compiled</span>}
            </div>
            {a.compiled ? (
              <>
                <MemoryFile profile={a.profile} file={a.memory} busy={a.busy} onSaved={(f) => update(a.profile, f)} />
                <MemoryFile profile={a.profile} file={a.user} busy={a.busy} onSaved={(f) => update(a.profile, f)} />
              </>
            ) : (
              <div className="card-body faint">Compile the board to create this agent's profile.</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
