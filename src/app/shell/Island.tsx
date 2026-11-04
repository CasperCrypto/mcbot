import { Check, LoaderCircle, X } from "lucide-react";
import { useMemo } from "react";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { AgentFace, clock, useNow } from "../ui";

/**
 * The live island in the title bar. One line, one thing at a time: an agent at
 * work (face + elapsed clock), a compile in flight, or the latest result.
 * Nothing happening → nothing shown.
 */
export function Island() {
  const { graph } = useBoard();
  const runs = useApp((s) => s.runs);
  const toasts = useApp((s) => s.toasts);
  const busy = useApp((s) => s.compileBusy);
  const dismiss = useApp((s) => s.dismiss);
  const openChat = useApp((s) => s.openChat);

  const running = useMemo(() => Object.values(runs).filter((r) => r.status === "running").sort((a, b) => a.startedAt - b.startedAt), [runs]);
  const now = useNow(running.length > 0);
  const toast = toasts.at(-1);

  let content: React.ReactNode = null;
  let key = "none";
  if (running.length) {
    const r = running[0]!;
    const agent = graph.nodes.find((n) => n.id === r.agentNodeId);
    const name = agent?.kind === "agent" ? agent.data.displayName || agent.data.name : r.profile;
    key = `run-${r.runId}`;
    content = (
      <button className="island" style={{ border: 0, height: 32 }} onClick={() => openChat(r.agentNodeId)} data-testid="island">
        <AgentFace seed={r.profile} size={22} status="running" />
        <span>{name}</span>
        {running.length > 1 && <span className="faint">+{running.length - 1}</span>}
        <span className="time">{clock(now - r.startedAt)}</span>
      </button>
    );
  } else if (busy) {
    key = "compiling";
    content = (
      <div className="island text-only" data-testid="island">
        <LoaderCircle size={14} className="spin-icon" />
        <span>Compiling</span>
      </div>
    );
  } else if (toast) {
    key = `toast-${toast.id}`;
    content = (
      <div className="island text-only" data-testid="island">
        {toast.kind === "fail" ? <X size={14} className="bad" /> : <Check size={14} className="ok" />}
        <span className="ellipsis" style={{ maxWidth: 420 }}>{toast.text}</span>
        {toast.action && <button onClick={() => { toast.action!.run(); dismiss(toast.id); }}>{toast.action.label}</button>}
      </div>
    );
  }
  return <div className="island-slot" key={key}>{content}</div>;
}
