/**
 * Share, like a shared document: pick who (teammates who edit and run the boards, or guests who
 * only chat with the agents you pick), then email the link or copy it, or show its QR code for a
 * phone. "Anyone with the link" works from anywhere through a free Cloudflare quick tunnel
 * (engine/tunnel.ts); "This network only" stays on the Wi-Fi. People open the link in any web
 * browser, no account and nothing to install, or paste it into Join in their own McBot.
 */
import { AlertTriangle, Check, Copy, Globe, Link2, LogOut, Mail, QrCode as QrIcon, RefreshCw, Users, Wifi, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ShareRole, SharingView } from "../../contracts/api";
import type { AgentNode } from "../../contracts/graph";
import { DEMO, engine, REMOTE } from "../lib/engine";
import { ago } from "../lib/format";
import { guestRisks } from "../lib/guestRisk";
import { MAIL_SERVICES, composeUrl, inviteMessage, isEmail, type MailService } from "../lib/invite";
import { openExternal } from "../lib/open";
import { usePresence } from "../lib/presence";
import { parseInvite, saveRemote } from "../lib/remote";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { AgentFace, PersonFace, Segmented } from "../ui";
import { QrCode } from "./QrCode";

const SERVICE_KEY = "mcbot.invite.mail";
const savedService = (): MailService => {
  try {
    const v = localStorage.getItem(SERVICE_KEY);
    return v === "outlook" || v === "app" ? v : "gmail";
  } catch {
    return "gmail";
  }
};
const ROLES: { value: ShareRole; label: string }[] = [
  { value: "edit", label: "Teammates" },
  { value: "chat", label: "Guests" },
];
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

function Join({ onCancel }: { onCancel?: () => void }) {
  const identity = useApp((s) => s.identity);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const invite = parseInvite(text);
  const join = async () => {
    if (!invite) return;
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch(`${invite.url}/api/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: invite.code, name: identity.name }) });
      const data = (await res.json().catch(() => ({}))) as { key?: string; role?: ShareRole; host?: string; error?: string };
      if (!res.ok || !data.key) throw new Error(data.error ?? `That computer answered ${res.status}`);
      saveRemote({ url: invite.url, key: data.key, label: data.host ?? invite.address, role: data.role ?? "edit" });
      location.reload();
    } catch (err) {
      setProblem(err instanceof TypeError ? "Can't reach that computer. Is their McBot open?" : (err as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="share-body">
      <label className="field"><span>Invite link</span>
        <input className="mono" value={text} onChange={(e) => { setText(e.target.value); setProblem(null); }} placeholder="https://…/join?code=K7Q-4XM-2PD" autoFocus data-testid="join-link"
          onKeyDown={(e) => { if (e.key === "Enter") void join(); }} />
        {text.trim() && !invite ? <span className="error">Paste the whole link you were sent</span> : problem ? <span className="error">{problem}</span> : null}
      </label>
      <div className="row"><span className="grow" />{onCancel && <button className="btn" onClick={onCancel}>Back</button>}<button className="btn primary" disabled={busy || !invite} onClick={() => void join()} data-testid="join-go">Join</button></div>
    </div>
  );
}

/** Addresses as chips: typing a comma, a space or Enter (or pasting a list) makes them. */
function EmailChips({ list, onChange, draft, onDraft, onEnter }: { list: string[]; onChange: (l: string[]) => void; draft: string; onDraft: (s: string) => void; onEnter: () => void }) {
  const take = (text: string) => {
    const parts = text.split(/[\s,;]+/);
    const rest = parts.pop() ?? "";
    const add = parts.map((p) => p.trim()).filter(Boolean);
    if (add.length) onChange([...new Set([...list, ...add])]);
    onDraft(rest);
  };
  return (
    <div className="email-chips" onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus()}>
      <Mail size={14} className="faint" />
      {list.map((e) => (
        <span key={e} className={`email-chip${isEmail(e) ? "" : " bad"}`} data-tip={isEmail(e) ? undefined : "Check this address"}>
          {e}<button aria-label={`Remove ${e}`} onClick={(ev) => { ev.stopPropagation(); onChange(list.filter((x) => x !== e)); }}><X size={11} /></button>
        </span>
      ))}
      <input value={draft} placeholder={list.length ? "" : "name@example.com"} aria-label="Email addresses" data-testid="share-email-to"
        onChange={(e) => take(e.target.value)}
        onBlur={() => { if (draft.trim()) take(`${draft},`); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); if (draft.trim()) take(`${draft},`); else onEnter(); }
          if (e.key === "Backspace" && !draft && list.length) onChange(list.slice(0, -1));
        }} />
    </div>
  );
}

export function ShareSheet() {
  const open = useApp((s) => s.shareOpen);
  const setOpen = useApp((s) => s.setShareOpen);
  const toast = useApp((s) => s.toast);
  const identity = useApp((s) => s.identity);
  const { boardId, graph } = useBoard();
  const agents = useMemo(() => graph.nodes.filter((n): n is AgentNode => n.kind === "agent"), [graph.nodes]);
  const [view, setView] = useState<SharingView | null>(null);
  const [joining, setJoining] = useState(false);
  const [role, setRole] = useState<ShareRole>("edit");
  const [picked, setPicked] = useState<string[]>([]);
  const [reachPick, setReachPick] = useState<"internet" | "network">("internet");
  const [to, setTo] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [service, setService] = useState<MailService>(savedService);
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ownOpen, setOwnOpen] = useState(false);
  const [own, setOwn] = useState("");
  const [sendWhenReady, setSendWhenReady] = useState(false);

  const starting = view?.on && view.reach === "internet" && !view.ownUrl && view.tunnel.state !== "on";
  useEffect(() => {
    if (!open) return;
    setJoining(false);
    const load = () => { if (!REMOTE && !DEMO) engine.share().then((v) => { setView(v); if (!v.on) setReachPick(v.members.length || v.reach === "network" ? v.reach : "internet"); }).catch(() => undefined); };
    load();
    const t = setInterval(load, starting ? 1000 : 4000);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen, starting]);

  // Guests' agents: every agent unless some are picked; forget ones no longer on the board.
  const scope = useMemo(() => picked.filter((id) => agents.some((a) => a.id === id)), [picked, agents]);
  const invite = view?.invites.find((i) => i.role === role && (role === "edit" || (i.boardId === boardId && sameList(i.agents ?? [], scope))));
  const link = view?.on ? invite?.link ?? null : null;
  const guestAgents = role === "chat" ? (scope.length ? agents.filter((a) => scope.includes(a.id)) : agents) : [];
  const risks = useMemo(() => guestAgents.flatMap((a) => guestRisks(a, graph).map((r) => `${a.data.displayName || a.data.name}: ${r}`)), [guestAgents, graph]);

  // Every link needs sharing on and a link for exactly these people.
  useEffect(() => {
    if (!open || !view?.on || invite || busy || (role === "chat" && agents.length === 0)) return;
    void act(() => engine.newInvite(role === "edit" ? { role: "edit" } : { role: "chat", boardId, agents: scope }));
  }, [open, view?.on, invite, role, scope.join(","), boardId]); // eslint-disable-line react-hooks/exhaustive-deps

  const presence = usePresence(open);

  async function act(f: () => Promise<SharingView>) {
    setBusy(true);
    try {
      setView(await f());
    } catch (err) {
      toast({ kind: "fail", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ kind: "info", text: "Select the link and copy it" });
    }
  };
  const recipients = [...to, ...(draft.trim() ? [draft.trim()] : [])];
  const allValid = recipients.length > 0 && recipients.every(isEmail);
  const email = (url = link) => {
    if (!url || !allValid) return;
    try {
      localStorage.setItem(SERVICE_KEY, service);
    } catch {
      /* this time only */
    }
    const { subject, body } = inviteMessage(identity.name, url, {
      role, agents: guestAgents.map((a) => a.data.displayName || a.data.name), web: view?.web !== false, network: view?.reach === "network",
    });
    void openExternal(composeUrl(service, recipients, subject, body))
      .then(() => { setTo([]); setDraft(""); toast({ kind: "ok", text: `Invite ready to send to ${recipients.join(", ")}` }); })
      .catch(() => toast({ kind: "fail", text: service === "app" ? "No mail app opened. Try Gmail or Outlook, or copy the link." : "Couldn't open your email. Copy the link instead." }));
  };
  // "Send invite" while the link is still being made sends it the moment it is ready.
  useEffect(() => {
    if (sendWhenReady && link) {
      setSendWhenReady(false);
      email(link);
    }
  });
  const sendInvite = () => {
    if (!allValid) return;
    if (link) return email(link);
    setSendWhenReady(true);
    if (!view?.on) void act(() => engine.setShare(true, reachPick));
  };
  const left = invite ? Math.max(1, Math.round((invite.expiresAt - Date.now()) / 3600_000)) : 0;
  const agentName = (id: string) => { const a = agents.find((x) => x.id === id); return a ? a.data.displayName || a.data.name : "an agent"; };
  const linkState = !view?.on ? null
    : view.reach === "internet" && !view.ownUrl && view.tunnel.state === "failed" ? "failed"
      : link ? "ready" : "making";
  if (!presence.mounted) return null;

  return (
    <>
      <div data-closing={presence.closing || undefined} className="palette-scrim" onClick={() => setOpen(false)} />
      <section className="palette hermes-sheet share-sheet" role="dialog" aria-modal="true" data-closing={presence.closing || undefined} aria-label="Share" data-testid="share-sheet">
        <header>
          <span className="hermes-mark" aria-hidden><Users size={18} /></span>
          <div className="grow">
            <h2>{REMOTE ? "Shared with you" : joining ? "Join someone's McBot" : "Share"}</h2>
            <small>{REMOTE ? `You're on ${REMOTE.label}'s McBot` : joining ? "Paste the link they sent you" : "Invite your team, or let people chat with your agents"}</small>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}><X size={15} /></button>
        </header>

        {REMOTE ? (
          <div className="share-body">
            <p className="faint" style={{ margin: 0 }}>Agents run on their computer, with their keys.</p>
            <div className="row"><span className="grow" /><button className="btn" onClick={() => { saveRemote(null); location.reload(); }} data-testid="share-leave"><LogOut size={13} /> Leave and go back to mine</button></div>
          </div>
        ) : DEMO ? (
          <div className="share-body">
            <p className="faint" style={{ margin: 0 }}>Inviting people works in the desktop app. Here, open this page in a second tab: both are live.</p>
          </div>
        ) : joining ? (
          <Join onCancel={() => setJoining(false)} />
        ) : (
          <div className="share-body">
            <div className="share-who">
              <div style={{ width: 230 }}><Segmented value={role} onChange={setRole} options={ROLES} /></div>
              <span className="faint share-who-note">{role === "edit" ? "Edit and run these boards with you" : "Chat with your agents, nothing else"}</span>
            </div>

            {role === "chat" && (
              agents.length === 0 ? <p className="faint" style={{ margin: 0 }}>Add an agent to this board first.</p> : (
                <div className="share-agents" data-testid="share-agents">
                  <button className={`share-agent${scope.length === 0 ? " on" : ""}`} onClick={() => setPicked([])} aria-pressed={scope.length === 0}>All agents</button>
                  {agents.map((a) => (
                    <button key={a.id} className={`share-agent${scope.includes(a.id) ? " on" : ""}`} aria-pressed={scope.includes(a.id)}
                      onClick={() => setPicked(scope.includes(a.id) ? scope.filter((x) => x !== a.id) : [...scope, a.id])}>
                      <AgentFace seed={a.data.name} size={18} />{a.data.displayName || a.data.name}
                    </button>
                  ))}
                </div>
              )
            )}
            {role === "chat" && risks.length > 0 && (
              <div className="share-risk" data-testid="share-risk" data-tip={risks.join("\n")}>
                <AlertTriangle size={13} />
                <span>Guests could ask {guestAgents.length === 1 ? "this agent" : "these agents"} to use {[...new Set(risks.map((r) => r.split(": ")[1]))].slice(0, 4).join(", ")} on this computer. For customers, give an agent without them.</span>
              </div>
            )}

            {!view ? <div className="skeleton" style={{ height: 96 }} /> : !view.on ? (
              <>
                <div className="share-reach" role="radiogroup" aria-label="Who the link reaches">
                  <button role="radio" aria-checked={reachPick === "internet"} className={`share-reach-opt${reachPick === "internet" ? " on" : ""}`} onClick={() => setReachPick("internet")} data-testid="share-reach-internet">
                    <Globe size={16} /><span><b>Anyone with the link</b><small>Works from anywhere, in any browser</small></span>
                  </button>
                  <button role="radio" aria-checked={reachPick === "network"} className={`share-reach-opt${reachPick === "network" ? " on" : ""}`} onClick={() => setReachPick("network")} data-testid="share-reach-network">
                    <Wifi size={16} /><span><b>This network only</b><small>People on the same Wi-Fi</small></span>
                  </button>
                </div>
                <button className="btn primary big share-create" disabled={busy || (role === "chat" && agents.length === 0)} onClick={() => void act(() => engine.setShare(true, reachPick))} data-testid="share-toggle">
                  <Link2 size={15} /> Create invite link
                </button>
              </>
            ) : (
              <>
                <div className="share-email">
                  <div className="share-email-row">
                    <EmailChips list={to} onChange={setTo} draft={draft} onDraft={setDraft} onEnter={sendInvite} />
                    <button className="btn primary" disabled={!allValid || sendWhenReady || linkState === "failed"} onClick={sendInvite} data-testid="share-email">{sendWhenReady ? "Making link…" : "Send invite"}</button>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="faint" style={{ fontSize: 12.5 }}>Send from</span>
                    <div style={{ width: 236 }}><Segmented value={service} onChange={setService} options={MAIL_SERVICES} /></div>
                    {recipients.length > 0 && !allValid && <span className="error" style={{ fontSize: 12.5 }}>Check the address</span>}
                  </div>
                </div>

                <div className={`share-link${linkState === "failed" ? " failed" : ""}`} data-testid="share-invite">
                  <span className="share-link-icon">{view.reach === "internet" ? <Globe size={15} /> : <Wifi size={15} />}</span>
                  {linkState === "ready" ? (
                    <span className="grow mono ellipsis" data-testid="share-link">{link}</span>
                  ) : linkState === "failed" ? (
                    <span className="grow share-link-msg">{view.tunnel.error ?? "The link couldn't be made."}</span>
                  ) : (
                    <span className="grow share-link-msg faint" data-testid="share-making">{view.reach === "network" && !view.addresses.length ? "This computer isn't on a network." : "Making your link…"}</span>
                  )}
                  {linkState === "ready" && <button className={`icon-btn sm${qr ? " on" : ""}`} aria-label="QR code" data-tip="Open on a phone" onClick={() => setQr(!qr)} data-testid="share-qr-toggle"><QrIcon size={14} /></button>}
                  {linkState === "failed"
                    ? <button className="btn sm" onClick={() => void act(() => engine.setShareReach("internet"))}><RefreshCw size={12} /> Try again</button>
                    : <button className="btn sm primary" disabled={!link} onClick={() => void copy()} data-testid="share-copy">{copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy link"}</button>}
                </div>
                {qr && link && (
                  <div className="share-qr">
                    <QrCode text={link} label="QR code of the invite link" />
                    <span className="faint">Scan with a phone's camera to open it there.</span>
                  </div>
                )}
                <div className="row share-link-meta">
                  <span className="faint">{view.reach === "internet" ? "Anyone with the link" : "This network only"}{invite ? ` · ${left} h left` : ""} · while McBot is open here</span>
                  <span className="grow" />
                  <button className="btn sm ghost" disabled={busy} onClick={() => void act(() => engine.setShareReach(view.reach === "internet" ? "network" : "internet"))} data-tip="Change who the link reaches">
                    {view.reach === "internet" ? <Wifi size={12} /> : <Globe size={12} />} {view.reach === "internet" ? "Network only" : "Anyone"}
                  </button>
                  <button className="btn sm ghost" disabled={busy} onClick={() => void act(() => engine.newInvite(role === "edit" ? { role: "edit" } : { role: "chat", boardId, agents: scope }))} data-tip="The old link stops working"><RefreshCw size={12} /> New link</button>
                </div>

                <div className="stack share-people" style={{ gap: 6 }}>
                  <span className="section-label">People</span>
                  <div className="row">
                    <PersonFace name={identity.name} color="#8e8e93" size={22} />
                    <span className="grow">{identity.name} <span className="faint">· you</span></span>
                  </div>
                  {view.members.map((m) => (
                    <div key={m.id} className="row" data-testid="share-member">
                      <PersonFace name={m.name} color="#8e8e93" size={22} />
                      <span className="grow ellipsis">{m.name} <span className="faint">· {m.role === "chat" ? `chats with ${m.agents?.length ? m.agents.map(agentName).join(", ") : "all agents"}` : "can edit"} · {Date.now() - m.lastSeen < 120_000 ? "here now" : `seen ${ago(m.lastSeen)}`}</span></span>
                      <button className="btn sm ghost" onClick={() => void act(() => engine.removeMember(m.id))}>Remove</button>
                    </div>
                  ))}
                </div>

                {view.reach === "internet" && (ownOpen ? (
                  <div className="share-own">
                    <input className="mono" value={own} onChange={(e) => setOwn(e.target.value)} placeholder="https://team.example.com" aria-label="Your own address" data-testid="share-own-url"
                      onKeyDown={(e) => { if (e.key === "Enter") void act(() => engine.setShareReach("internet", own.trim() || null)).then(() => setOwnOpen(false)); }} />
                    <button className="btn sm" onClick={() => void act(() => engine.setShareReach("internet", own.trim() || null)).then(() => setOwnOpen(false))}>{own.trim() ? "Use it" : "Use Cloudflare's"}</button>
                  </div>
                ) : (
                  <button className="link-btn share-own-open" onClick={() => { setOwn(view.ownUrl ?? ""); setOwnOpen(true); }} data-tip="A permanent address that forwards to port 4318 (your own Cloudflare tunnel, Tailscale…)">
                    {view.ownUrl ? `Your own address: ${view.ownUrl}` : "Use your own address"}
                  </button>
                ))}
              </>
            )}
            <div className="row">
              <span className="faint" style={{ fontSize: 12.5 }}>Your keys and files stay on this computer.</span>
              <span className="grow" />
              {view?.on && <button className="btn ghost sm" disabled={busy} onClick={() => void act(() => engine.setShare(false))} data-testid="share-stop">Stop sharing</button>}
              <button className="btn ghost sm" onClick={() => setJoining(true)} data-testid="share-join">Join someone else's</button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
