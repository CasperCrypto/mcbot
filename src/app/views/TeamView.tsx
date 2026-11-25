/**
 * Team: the people on this board and the team chat. You (name, what you do, colour: teammates see them
 * beside your face), who is here now and where, and everyone with access (Share's members, with their
 * role and when they were last here; the host can remove them). Invite opens Share.
 */
import { MessagesSquare, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import type { SharingView } from "../../contracts/api";
import { TeamChat } from "../shell/TeamPanel";
import { PEER_COLORS } from "../lib/identity";
import { engine, REMOTE } from "../lib/engine";
import { ago } from "../lib/format";
import { VIEWS } from "../shell/Palette";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { PersonFace } from "../ui";

const ROLE: Record<string, string> = { edit: "Can edit", chat: "Can chat" };

export function TeamView() {
  const { peers, graph } = useBoard();
  const identity = useApp((s) => s.identity);
  const setIdentity = useApp((s) => s.setIdentity);
  const setShareOpen = useApp((s) => s.setShareOpen);
  const toast = useApp((s) => s.toast);
  const tab = useApp((s) => s.tab);
  const selected = useApp((s) => s.selectedNodeId);
  const [name, setName] = useState(identity.name);
  const [title, setTitle] = useState(identity.title ?? "");
  const [share, setShare] = useState<SharingView | null>(null);
  useEffect(() => {
    if (REMOTE) return;
    let live = true;
    const load = () => engine.share().then((v) => { if (live) setShare(v); }).catch(() => undefined);
    void load();
    const t = setInterval(load, 15_000);
    return () => { live = false; clearInterval(t); };
  }, []);

  const where = (t: string | null, sel: string | null) => {
    const view = VIEWS.find((v) => v.tab === t)?.label ?? "—";
    const n = graph.nodes.find((x) => x.id === sel);
    const node = n ? (n.kind === "agent" ? n.data.displayName : n.data.label) || n.data.name : null;
    return node ? `${view} · ${node}` : view;
  };
  const commit = () => {
    const next = { ...identity, name: name.trim() || identity.name, chosen: name.trim() ? true : identity.chosen, title: title.trim().slice(0, 60) || undefined };
    if (next.name !== identity.name || next.title !== identity.title) setIdentity(next);
  };
  const remove = async (id: string, who: string) => {
    try {
      setShare(await engine.removeMember(id));
      toast({ kind: "ok", text: `${who} no longer has access` });
    } catch (err) {
      toast({ kind: "fail", text: (err as Error).message });
    }
  };
  const online = new Set(peers.map((p) => p.name));
  // A member's colour: theirs while they are here, else one picked from their name.
  const colorOf = (who: string) => peers.find((p) => p.name === who)?.color ?? PEER_COLORS[[...who].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PEER_COLORS.length]!;
  const members = share?.members ?? [];

  return (
    <section className="main flush-left">
      <div className="team-page page-enter">
        <div className="team-people-col">
          <div className="team-head">
            <h2 className="team-page-title grow">People</h2>
            {!REMOTE && <button className="btn sm primary" onClick={() => setShareOpen(true)} data-testid="team-invite"><UserPlus size={13} /> Invite</button>}
          </div>
          <div className="people" data-testid="team">
            <div className="card person">
              <PersonFace name={identity.name} color={identity.color} size={64} />
              <input className="name-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} aria-label="Your name" data-testid="identity-name" />
              <input className="title-input" value={title} placeholder="What you do" maxLength={60} onChange={(e) => setTitle(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} aria-label="What you do" data-testid="identity-title" />
              <div className="swatches">
                {PEER_COLORS.map((c) => <button key={c} className="swatch" style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={c === identity.color} onClick={() => setIdentity({ ...identity, color: c })} />)}
              </div>
              <span className="where">You · {where(tab, selected)}</span>
            </div>
            {peers.map((p) => (
              <div key={p.clientId} className="card person">
                <PersonFace name={p.name} color={p.color} size={64} />
                <span className="name">{p.name}</span>
                {p.title && <span className="faint person-title">{p.title}</span>}
                <span className="where">{where(p.tab, p.selection)}</span>
              </div>
            ))}
          </div>
          {!REMOTE && (
            <div className="team-access" data-testid="team-access">
              <h3 className="team-sub">Everyone with access</h3>
              {members.length === 0 ? (
                <p className="faint team-empty">Only you. Invite teammates to build with you, or guests to chat with your agents.</p>
              ) : (
                <div className="team-members">
                  {members.map((m) => (
                    <div key={m.id} className="team-member" data-testid="team-member">
                      <PersonFace name={m.name} color={colorOf(m.name)} size={26} />
                      <span className="grow team-member-text">
                        <b className="ellipsis">{m.name}</b>
                        <small className="faint">{online.has(m.name) ? "Here now" : m.lastSeen ? `Last here ${ago(m.lastSeen)}` : `Joined ${ago(m.joinedAt)}`}</small>
                      </span>
                      <span className="chip">{ROLE[m.role] ?? m.role}</span>
                      <button className="btn sm ghost" onClick={() => void remove(m.id, m.name)} data-testid="team-remove">Remove</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="card team-chat-col">
          <div className="team-page-head"><MessagesSquare size={14} className="faint" /><b>Team chat</b><span className="faint">· @agent asks an agent</span></div>
          <TeamChat />
        </div>
      </div>
    </section>
  );
}
