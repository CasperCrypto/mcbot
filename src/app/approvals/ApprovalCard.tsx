import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import type { RunSummary } from "../../contracts/run";
import { engine } from "../lib/engine";
import { useApp } from "../state/store";

/** Hermes' choices, in the order a person reads them. */
const LABELS: Record<string, { label: string; tip: string }> = {
  once: { label: "Allow once", tip: "Just this time" },
  session: { label: "Allow for this chat", tip: "Until this conversation ends" },
  always: { label: "Always allow", tip: "This kind of command, from now on" },
  deny: { label: "Deny", tip: "The agent finds another way" },
};
const ORDER = ["once", "session", "always", "deny"];

/** Hermes stopped before a risky action and asks the person. One tap answers it. */
export function ApprovalCard({ run, compact = false }: { run: RunSummary; compact?: boolean }) {
  const toast = useApp((s) => s.toast);
  const [busy, setBusy] = useState(false);
  if (!run.approval) return null;
  const a = run.approval;
  const answer = async (choice: string) => {
    setBusy(true);
    try {
      await engine.answerRun(run.runId, choice);
    } catch (err) {
      toast({ kind: "fail", text: (err as Error).message });
      setBusy(false);
    }
  };
  return (
    <div className={`approval${compact ? " compact" : ""}`} data-testid="approval-card">
      <div className="approval-head"><ShieldAlert size={14} /><b>Allow this?</b><span className="faint grow ellipsis">{a.description}</span></div>
      <pre className="approval-cmd">{a.command}</pre>
      <div className="approval-actions">
        {ORDER.filter((c) => a.choices.includes(c)).map((c) => (
          <button key={c} className={`btn sm${c === "once" ? " primary" : c === "deny" ? " danger" : ""}`} disabled={busy} data-tip={LABELS[c]?.tip} onClick={() => void answer(c)} data-testid={`approval-${c}`}>
            {LABELS[c]?.label ?? c}
          </button>
        ))}
      </div>
    </div>
  );
}
