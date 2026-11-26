/**
 * "Ask an agent about this", the same everywhere it appears (Files, Knowledge's documents and memory):
 * pick an agent, type, Enter. What the view is showing goes along with the question (`about`, read
 * when it is sent), the run starts as a message from Chat would (queued while the agent works), and
 * a notice offers to open the answer.
 */
import { MessageSquare } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { AgentNode } from "../../contracts/graph";
import { runAgent } from "../actions";
import { agentOptions } from "../lib/agentOptions";
import { Picker } from "../Picker";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";

/** The agent a person asked last, kept per window so every bar starts on it. */
let lastAgent = "";

export function AskBar({ about, placeholder, quick, testId, className, prefer }: {
  /** What goes along with the question: the file, the folder, the document… (null: nothing to ask about yet). */
  about: () => string | null | Promise<string | null>;
  /** The agent this is about (its node id), asked unless the person picks another. */
  prefer?: string;
  placeholder: string;
  /** One-click questions. */
  quick?: { label: string; ask: string }[];
  testId?: string;
  className?: string;
}): ReactNode {
  const { boardId, graph } = useBoard();
  const agents = useMemo(() => graph.nodes.filter((n): n is AgentNode => n.kind === "agent"), [graph]);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const agent = agents.find((a) => a.id === (agentId ?? prefer ?? lastAgent)) ?? agents[0];
  if (!agent) return null;

  const ask = async (preset?: string) => {
    const q = (preset ?? question).trim();
    if (!q || busy) return;
    setBusy(true);
    try {
      const context = await about();
      const runId = await runAgent(boardId, agent.id, context ? `${q}\n\n${context}` : q);
      if (runId) {
        if (!preset) setQuestion("");
        const name = agent.data.displayName || agent.data.name;
        useApp.getState().toast({ kind: "ok", text: `Asked ${name}`, action: { label: "Open", run: () => useApp.getState().openChat(agent.id) } });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`code-ask ask-bar${className ? ` ${className}` : ""}`}>
      <MessageSquare size={13} className="faint" />
      <Picker sm label="Agent" value={agent.id} onChange={(id) => { lastAgent = id; setAgentId(id); }} options={agentOptions(agents)} />
      <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={placeholder} disabled={busy}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void ask(); }} data-testid={testId} aria-label={`Ask ${agent.data.displayName || agent.data.name}`} />
      {quick && quick.length > 0 && (
        <div className="ask-quick">
          {quick.map((q) => <button key={q.label} className="chip" onClick={() => void ask(q.ask)} data-tip={q.ask} data-tip-side="top" disabled={busy}>{q.label}</button>)}
        </div>
      )}
    </div>
  );
}
