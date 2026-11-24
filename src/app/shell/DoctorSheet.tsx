/**
 * Harness doctor (graph/doctor.ts): the title bar's check button counts what is wrong, and this
 * sheet lists it, each line with the one action that fixes it. Removing a lone block is undoable (⌘Z).
 */
import { CircleCheck, CircleX, Lightbulb, Stethoscope, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { removeNodes } from "../../board/ydoc";
import { compileBoard } from "../actions";
import { checkHarness, type Finding } from "../graph/doctor";
import { REMOTE, engine, onKeysChanged } from "../lib/engine";
import { modelsOf } from "../lib/models";
import { usePresence } from "../lib/presence";
import { useModelHealth } from "../lib/useModelHealth";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";

/** What the doctor finds on this board now; the title bar and the sheet share it. */
export function useDoctor(): Finding[] {
  const { graph } = useBoard();
  const drift = useApp((s) => s.drift);
  const health = useApp((s) => s.health);
  const [keys, setKeys] = useState<string[] | null>(null);
  const keysKey = useMemo(() => modelsOf(graph).map((m) => m.data.apiKeyEnv).join(","), [graph]);
  // Asked again whenever a key is saved or removed (Settings, the inspector), so a fixed key stops being a finding.
  const [keysRev, setKeysRev] = useState(0);
  useEffect(() => {
    return onKeysChanged(() => setKeysRev((n) => n + 1));
  }, []);
  useEffect(() => {
    // A teammate's window never sees the host's keys: no key findings there.
    if (REMOTE) return;
    engine.secrets().then((r) => setKeys(r.names)).catch(() => setKeys(null));
  }, [keysKey, keysRev]);
  const modelHealth = useModelHealth(modelsOf(graph));
  return useMemo(() => checkHarness(graph, { keys, health: modelHealth, drift, engineReady: REMOTE || !health ? null : health.hermes.found }), [graph, keys, modelHealth, drift, health]);
}

const ICON = { error: <CircleX size={16} />, warn: <TriangleAlert size={16} />, tip: <Lightbulb size={16} /> };

/** Do a finding's one fix (the doctor sheet and the island share it). */
export function applyFix(f: Finding, boardId: string, doc: Parameters<typeof removeNodes>[0]): void {
  const app = useApp.getState();
  const x = f.fix;
  if (x.kind === "select") { app.setDoctorOpen(false); app.setTab("graph"); app.select(x.nodeId); }
  if (x.kind === "settings") { app.setDoctorOpen(false); app.openSettings(x.page); }
  if (x.kind === "compile") void compileBoard(boardId);
  if (x.kind === "delete") { removeNodes(doc, [x.nodeId]); app.toast({ kind: "ok", text: "Removed · ⌘Z brings it back" }); }
}

export function DoctorSheet() {
  const open = useApp((s) => s.doctorOpen);
  const setOpen = useApp((s) => s.setDoctorOpen);
  const { boardId, doc } = useBoard();
  const findings = useDoctor();
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  const presence = usePresence(open);
  if (!presence.mounted) return null;

  const fix = (f: Finding) => applyFix(f, boardId, doc);
  const errors = findings.filter((f) => f.level === "error").length;

  return (
    <>
      <div data-closing={presence.closing || undefined} className="palette-scrim" onClick={() => setOpen(false)} />
      <section className="palette hermes-sheet doctor-sheet" role="dialog" aria-modal="true" data-closing={presence.closing || undefined} aria-label="Check the harness" data-testid="doctor-sheet">
        <header>
          <span className="hermes-mark" aria-hidden><Stethoscope size={18} /></span>
          <div className="grow">
            <h2>{findings.length === 0 ? "All good" : errors ? `${errors} thing${errors > 1 ? "s" : ""} to fix` : `${findings.length} to look at`}</h2>
            <small>The whole harness, checked: models, keys, wires, budgets, files.</small>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}><X size={15} /></button>
        </header>
        {findings.length === 0 ? (
          <div className="doctor-ok"><CircleCheck size={28} /><span>Every agent has a model, every key is saved, every block is wired.</span></div>
        ) : (
          <div className="doctor-list" role="list">
            {findings.map((f) => (
              <div key={f.id} role="listitem" className={`doctor-row ${f.level}`} data-testid={`finding-${f.id}`}>
                <span className="doctor-icon">{ICON[f.level]}</span>
                <span className="grow" style={{ display: "grid", gap: 1, minWidth: 0 }}><b className="ellipsis">{f.title}</b><small className="faint">{f.sub}</small></span>
                <button className={`btn sm${f.level === "error" ? " primary" : ""}`} onClick={() => fix(f)}>{f.fix.label}</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
