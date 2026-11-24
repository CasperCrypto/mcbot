/**
 * A guest's McBot (Share → Can chat): a chat with the agents the host picked, and nothing else.
 * Agents run on the host's computer, with the host's models and keys; a guest sees only their own
 * questions and answers, and anything an agent asks to do is the host's to allow.
 */
import { ArrowUp, LogOut, RefreshCw, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GuestView } from "../../contracts/api";
import { starterPrompts } from "../chat/starters";
import { Logo } from "../faces/FoodFace";
import { engine, EngineError, REMOTE, subscribeRunEvents } from "../lib/engine";
import { saveRemote } from "../lib/remote";
import { useApp } from "../state/store";
import { AgentFace } from "../ui";
import { AgentMessage } from "../views/AgentsView";

const leave = () => {
  saveRemote(null);
  location.replace("/join");
};

export function GuestChat() {
  const [view, setView] = useState<GuestView | null>(null);
  const [problem, setProblem] = useState<{ text: string; gone: boolean } | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const runs = useApp((s) => s.runs);
  const events = useApp((s) => s.events);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const load = () => {
    setProblem(null);
    engine.guest().then((v) => {
      setView(v);
      setAgentId((id) => (id && v.agents.some((a) => a.id === id) ? id : v.agents[0]?.id ?? null));
      document.title = `${v.host} · McBot Studio`;
      if (!v.boardId) return;
      // The store keeps the runs of the board it is on; a guest's board is theirs.
      if (useApp.getState().boardId !== v.boardId) useApp.getState().setBoard(v.boardId);
      engine.runs(v.boardId).then(useApp.getState().loadRuns).catch(() => undefined);
    }).catch((err: unknown) => {
      const gone = err instanceof EngineError && (err.status === 401 || err.status === 403);
      setProblem({ gone, text: gone ? `${REMOTE?.label ?? "They"} stopped sharing, or the link was replaced.` : `Can't reach ${REMOTE?.label ?? "their"}'s McBot. It works while it's open on their computer.` });
    });
  };
  useEffect(load, []);
  useEffect(() => subscribeRunEvents(useApp.getState().applyEvent, setOnline), []);

  const agent = view?.agents.find((a) => a.id === agentId) ?? null;
  const name = agent ? agent.displayName || agent.name : "";
  const thread = useMemo(() => Object.values(runs).filter((r) => r.agentNodeId === agentId).sort((a, b) => a.startedAt - b.startedAt), [runs, agentId]);
  const running = thread.find((r) => r.status === "running");
  const textLen = thread.reduce((n, r) => n + r.text.length, 0);

  useEffect(() => {
    for (const r of thread) if (!events[r.runId]) engine.run(r.runId).then((e) => useApp.getState().loadEvents(r.runId, e)).catch(() => undefined);
  }, [thread.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [thread.length, textLen, agentId]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    if (draft) el.style.height = `${Math.min(180, el.scrollHeight)}px`;
  }, [draft]);

  const ask = async (prompt: string) => {
    if (!view?.boardId || !agent || !prompt.trim() || running || sending) return;
    setSending(true);
    setNote(null);
    try {
      await engine.startRun(view.boardId, agent.id, prompt.trim());
      setDraft("");
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  if (problem) {
    return (
      <div className="webjoin" data-testid="guest-problem">
        <main className="webjoin-card">
          <Logo size={56} />
          <h1>{problem.gone ? "This link has ended" : "Can't connect"}</h1>
          <p className="webjoin-sub">{problem.text}</p>
          <div className="row" style={{ justifyContent: "center", gap: 8 }}>
            {!problem.gone && <button className="btn primary" onClick={load}><RefreshCw size={13} /> Try again</button>}
            <button className="btn" onClick={leave}><LogOut size={13} /> Use another link</button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="guest" data-testid="guest-chat">
      <header className="guest-top">
        <Logo size={22} />
        <b className="guest-host">{view?.host ?? REMOTE?.label ?? ""}</b>
        {!online && <span className="guest-offline" data-tip="Reconnecting">Offline</span>}
        <span className="grow" />
        <span className="faint guest-me">{view?.name}</span>
        <button className="icon-btn sm" aria-label="Leave" data-tip="Leave" onClick={leave}><LogOut size={14} /></button>
      </header>

      {view && view.agents.length > 1 && (
        <nav className="guest-agents" aria-label="Agents">
          {view.agents.map((a) => (
            <button key={a.id} className={`guest-agent${a.id === agentId ? " on" : ""}`} onClick={() => setAgentId(a.id)} aria-pressed={a.id === agentId}>
              <AgentFace seed={a.name} size={22} />
              <span>{a.displayName || a.name}</span>
            </button>
          ))}
        </nav>
      )}

      <div className="guest-scroll" ref={scroller}>
        <div className="guest-inner thread-inner" data-testid="thread">
          {!view ? (
            <div className="skeleton" style={{ height: 120, marginTop: 80 }} />
          ) : !agent ? (
            <div className="guest-empty"><p>No agents to chat with here yet.</p></div>
          ) : thread.length === 0 ? (
            <div className="guest-empty">
              <AgentFace seed={agent.name} size={84} />
              <h2>{name}</h2>
              <p>{agent.description || "Ask anything."}</p>
              <div className="rich-choices starters">
                {starterPrompts(name, agent.description).map((q) => <button key={q} className="rich-choice" onClick={() => void ask(q)}>{q}</button>)}
              </div>
            </div>
          ) : (
            thread.map((r) => (
              <div key={r.runId} style={{ display: "grid", gap: 14 }}>
                <div className="msg user"><div className="bubble">{r.prompt}</div></div>
                <AgentMessage run={r} events={events[r.runId]} name={name} waitingFor={view.host}
                  onChoose={r === thread.at(-1) ? (reply) => void ask(reply) : undefined} />
              </div>
            ))
          )}
        </div>
      </div>

      {agent && (
        <div className="guest-compose composer-wrap">
          {note && <p className="guest-note error" role="alert">{note}</p>}
          <div className="composer">
            <textarea rows={1} ref={box} value={draft} placeholder={running ? `${name} is answering…` : `Message ${name}`} data-testid="composer"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(draft); } }} />
            {running
              ? <button className="send stop" aria-label="Stop" data-tip="Stop" onClick={() => void engine.cancelRun(running.runId).catch(() => undefined)}><Square size={12} /></button>
              : <button className="send" aria-label="Send" disabled={!draft.trim() || sending} onClick={() => void ask(draft)} data-testid="send"><ArrowUp size={16} /></button>}
          </div>
          <small className="guest-foot">Answers come from {view?.host ?? "their"}'s agents · <a href="https://mcbot.studio" target="_blank" rel="noreferrer noopener">McBot Studio</a></small>
        </div>
      )}
    </div>
  );
}
