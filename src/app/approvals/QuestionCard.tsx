import { ArrowUp, Check, CircleHelp } from "lucide-react";
import { useEffect, useState } from "react";
import type { RunSummary } from "../../contracts/run";
import { engine } from "../lib/engine";
import { useApp } from "../state/store";
import { encodeAnswer, questionChoices, secondsLeft } from "./question";

/** "1:05", "42 s". */
const clock = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s} s`);

/**
 * The agent stopped to ask the person something (Hermes' clarify): its options as buttons (one tap
 * answers; several when it allows), a field for anything else, and Skip. Hermes stops waiting after
 * its limit (90 s by default) and the agent goes on without an answer.
 */
export function QuestionCard({ run, compact = false }: { run: RunSummary; compact?: boolean }) {
  const toast = useApp((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const q = run.question ?? null;
  useEffect(() => {
    setPicked([]);
    setText("");
    setBusy(false);
  }, [q?.promptId]);
  useEffect(() => {
    if (!q?.timeoutS) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [q?.promptId, q?.timeoutS]);
  if (!q) return null;
  const choices = questionChoices(q.choices);
  const left = secondsLeft(q.at, q.timeoutS, now);
  const send = async (answer: string) => {
    setBusy(true);
    try {
      await engine.replyRun(run.runId, q.promptId, answer);
    } catch (err) {
      toast({ kind: "fail", text: (err as Error).message });
      setBusy(false);
    }
  };
  const toggle = (value: string) => setPicked((p) => (p.includes(value) ? p.filter((v) => v !== value) : [...p, value]));
  return (
    <div className={`approval question${compact ? " compact" : ""}`} data-testid="question-card">
      <div className="approval-head">
        <CircleHelp size={14} /><b className="grow">{q.question || "A question for you"}</b>
        {left !== null && <span className="faint num" data-tip="After this the agent goes on without an answer">{left > 0 ? clock(left) : "—"}</span>}
      </div>
      {choices.length > 0 && (
        <div className="approval-actions question-choices">
          {choices.map((c) => (
            q.multiSelect ? (
              <button key={c.value} type="button" className="btn sm" aria-pressed={picked.includes(c.value)} disabled={busy} onClick={() => toggle(c.value)} data-testid="question-choice">
                {picked.includes(c.value) && <Check size={12} />}{c.label}{c.recommended && <span className="question-tag">Suggested</span>}
              </button>
            ) : (
              <button key={c.value} type="button" className={`btn sm${c.recommended ? " primary" : ""}`} disabled={busy} onClick={() => void send(encodeAnswer({ picked: [c.value], multi: false }))} data-testid="question-choice">
                {c.label}{c.recommended && !compact && <span className="question-tag">Suggested</span>}
              </button>
            )
          ))}
          {q.multiSelect && <button type="button" className="btn sm primary" disabled={busy || picked.length === 0} onClick={() => void send(encodeAnswer({ picked, multi: true }))} data-testid="question-send-picked">Send</button>}
        </div>
      )}
      <form className="question-reply" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void send(encodeAnswer({ text })); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} disabled={busy} placeholder={choices.length ? "Something else…" : "Your answer…"} aria-label="Your answer" data-testid="question-text" />
        <button type="submit" className="icon-btn" disabled={busy || !text.trim()} aria-label="Send answer"><ArrowUp size={14} /></button>
        <button type="button" className="btn sm ghost" disabled={busy} onClick={() => void send(encodeAnswer("skip"))} data-tip="The agent decides itself" data-testid="question-skip">Skip</button>
      </form>
    </div>
  );
}
