/**
 * The team on this board: who is here now, who has joined, and the board's chat. People and agents
 * talk in one place: "@triage summarise today's tickets" runs the agent and posts its answer.
 * Messages live in the board (`messages`, src/board/ydoc.ts), so everyone on it sees them live.
 */
import { ArrowUp, MessagesSquare, UserPlus, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { addMessage } from "../../board/ydoc";
import type { AgentNode, Message } from "../../contracts/graph";
import type { SharingView } from "../../contracts/api";
import { runAgent } from "../actions";
import { mentionOf } from "../lib/mention";
import { engine, REMOTE } from "../lib/engine";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { AgentFace, PersonFace } from "../ui";

const VIEW: Record<string, string> = { home: "Home", graph: "Board", agents: "Chat", tasks: "Tasks", code: "Code", browser: "Browser", runs: "Activity", memory: "Memory", files: "Files", cost: "Cost" };
const newId = () => `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function ago(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

/** When the run ends, its answer goes into the chat as the agent's message. */
function postAnswerWhenDone(post: (m: Message) => void, runId: string, agent: AgentNode): void {
  const done = (): boolean => {
    const r = useApp.getState().runs[runId];
    if (!r || r.status === "running" || r.status === "queued") return false;
    const text = r.status === "succeeded" ? r.text.trim() || "Done." : `I couldn't finish: ${r.error ?? r.status}`;
    post({ id: newId(), author: agent.data.displayName || agent.data.name, color: "", agent: agent.data.name, text, at: Date.now() });
    return true;
  };
  if (done()) return;
  const stop = useApp.subscribe(() => { if (done()) stop(); });
  setTimeout(stop, 30 * 60_000);
}

const SEEN_KEY = (boardId: string) => `mcbot.chatSeen.${boardId}`;
export function unreadCount(boardId: string, messages: readonly Message[] | undefined, me: string): number {
  let seen = 0;
  try {
    seen = Number(localStorage.getItem(SEEN_KEY(boardId)) ?? 0);
  } catch {
    /* no storage: everything counts as read */
    return 0;
  }
  return (messages ?? []).filter((m) => m.at > seen && m.author !== me).length;
}

export function TeamPanel() {
  const open = useApp((s) => s.teamOpen);
  const setOpen = useApp((s) => s.setTeamOpen);
  const identity = useApp((s) => s.identity);
  const runs = useApp((s) => s.runs);
  const { boardId, doc, graph, peers } = useBoard();
  const [tab, setTab] = useState<"chat" | "people">("chat");
  const [draft, setDraft] = useState("");
  const [share, setShare] = useState<SharingView | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const agents = useMemo(() => graph.nodes.filter((n): n is AgentNode => n.kind === "agent"), [graph]);
  const messages = graph.messages ?? [];
  const asking = Object.values(runs).filter((r) => r.status === "running" && r.prompt.startsWith("[team chat]")).length;

  useEffect(() => {
    if (!open) return;
    if (!REMOTE) engine.share().then(setShare).catch(() => setShare(null));
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  useEffect(() => {
    if (!open || tab !== "chat") return;
    try {
      localStorage.setItem(SEEN_KEY(boardId), String(Date.now()));
    } catch {
      /* fine */
    }
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [open, tab, messages.length, boardId]);
  if (!open) return null;

  const post = (m: Message) => addMessage(doc, m);
  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    post({ id: newId(), author: identity.name, color: identity.color, agent: "", text, at: Date.now() });
    const mention = mentionOf(text, agents);
    if (mention) {
      const runId = await runAgent(boardId, mention.agent.id, `[team chat] ${identity.name} asks: ${mention.prompt}`);
      if (runId) postAnswerWhenDone(post, runId, mention.agent);
    }
  };

  const here = [{ clientId: -1, name: identity.name, color: identity.color, tab: useApp.getState().tab as string | null, me: true }, ...peers.map((p) => ({ ...p, me: false }))];
  // Teammates who joined from other computers; the ones here now are listed above already.
  const members = (share?.members ?? []).filter((m) => !here.some((h) => h.name === m.name));

  return (
    <aside className="team-panel" role="dialog" aria-label="Team" data-testid="team-panel">
      <header className="team-head">
        <div className="seg">
          <button aria-pressed={tab === "chat"} onClick={() => setTab("chat")} data-testid="team-tab-chat"><MessagesSquare size={13} /> Chat</button>
          <button aria-pressed={tab === "people"} onClick={() => setTab("people")} data-testid="team-tab-people"><Users size={13} /> People <span className="chip">{here.length}</span></button>
        </div>
        <span className="grow" />
        <button className="icon-btn sm" aria-label="Close" onClick={() => setOpen(false)}><X size={14} /></button>
      </header>

      {tab === "chat" ? (
        <>
          <div className="team-scroll" ref={scroller} data-testid="team-chat">
            {messages.length === 0 && <div className="faint team-empty">Say hi. Type @{agents[0]?.data.name ?? "agent"} to ask an agent.</div>}
            {messages.map((m) => (
              <div key={m.id} className={`team-msg${m.agent ? " agent" : ""}${!m.agent && m.author === identity.name ? " mine" : ""}`} data-testid="team-message">
                {m.agent ? <AgentFace seed={m.agent} size={24} /> : <PersonFace name={m.author} color={m.color || "#888"} size={24} />}
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="team-meta"><b>{m.author || "Someone"}</b><span className="faint">{ago(m.at)}</span></div>
                  <div className="team-text">{m.text}</div>
                </div>
              </div>
            ))}
            {asking > 0 && <div className="faint team-empty"><span className="typing"><i /><i /><i /></span></div>}
          </div>
          <div className="team-compose">
            <textarea rows={1} value={draft} placeholder={agents.length ? `Message the team, or @${agents[0]!.data.name} to ask` : "Message the team"} data-testid="team-composer"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
            <button className="send" aria-label="Send" disabled={!draft.trim()} onClick={() => void send()} data-testid="team-send"><ArrowUp size={15} /></button>
          </div>
        </>
      ) : (
        <div className="team-scroll" data-testid="team-people">
          <span className="section-label">Here now</span>
          {here.map((p) => (
            <div key={p.clientId} className="team-person" data-testid="team-here">
              <span className="online-dot" aria-hidden />
              <PersonFace name={p.name} color={p.color} size={28} />
              <span className="grow"><b>{p.name}{p.me ? " (you)" : ""}</b><span className="faint">{p.tab ? `In ${VIEW[p.tab] ?? p.tab}` : "Here"}</span></span>
            </div>
          ))}
          {members.length > 0 && <span className="section-label">Away</span>}
          {members.map((m) => (
            <div key={m.id} className="team-person">
              <PersonFace name={m.name} color="#888" size={28} />
              <span className="grow"><b>{m.name}</b><span className="faint">Seen {ago(m.lastSeen)}</span></span>
            </div>
          ))}
          <span className="section-label">Agents</span>
          {agents.map((a) => {
            const busy = Object.values(runs).some((r) => r.agentNodeId === a.id && r.status === "running");
            return (
              <div key={a.id} className="team-person">
                <AgentFace seed={a.data.name} size={28} status={busy ? "running" : null} />
                <span className="grow"><b>{a.data.displayName || a.data.name}</b><span className="faint">{busy ? "Working…" : `@${a.data.name}`}</span></span>
              </div>
            );
          })}
          {!REMOTE && (
            <button className="btn light" style={{ marginTop: 8 }} onClick={() => { setOpen(false); useApp.getState().setShareOpen(true); }} data-testid="team-invite">
              <UserPlus size={14} /> Invite a teammate
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
