/**
 * Invite your team, like a shared link: one click makes a link that works for 24 hours for
 * everyone it is sent to (copy it, or email it), until a new link replaces it. Teammates paste
 * the link into Join. Sharing turns on with the first link and off with "Stop sharing".
 */
import { Check, Copy, Link2, LogOut, Mail, RefreshCw, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { SharingView } from "../../contracts/api";
import { DEMO, engine, REMOTE } from "../lib/engine";
import { openExternal } from "../lib/open";
import { parseInvite, remoteUrl, saveRemote } from "../lib/remote";
import { useApp } from "../state/store";
import { PersonFace, Segmented } from "../ui";
import { MAIL_SERVICES, composeUrl, inviteMessage, parseEmails, type MailService } from "../lib/invite";

const SERVICE_KEY = "mcbot.invite.mail";
const savedService = (): MailService => {
  try {
    const v = localStorage.getItem(SERVICE_KEY);
    return v === "outlook" || v === "app" ? v : "gmail";
  } catch {
    return "gmail";
  }
};
import { ago } from "../lib/format";

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
    const url = remoteUrl(invite.address);
    try {
      const res = await fetch(`${url}/api/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: invite.code, name: identity.name }) });
      const data = (await res.json().catch(() => ({}))) as { key?: string; error?: string };
      if (!res.ok || !data.key) throw new Error(data.error ?? `That computer answered ${res.status}`);
      saveRemote({ url, key: data.key, label: invite.address });
      location.reload();
    } catch (err) {
      setProblem(err instanceof TypeError ? "Can't reach that computer. Same network? Is McBot open there?" : (err as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="share-body">
      <label className="field"><span>Invite link</span>
        <input className="mono" value={text} onChange={(e) => { setText(e.target.value); setProblem(null); }} placeholder="http://192.168.1.20:4318/join?code=K7Q-4XM" autoFocus data-testid="join-link"
          onKeyDown={(e) => { if (e.key === "Enter") void join(); }} />
        {text.trim() && !invite ? <span className="error">Paste the whole link your teammate sent</span> : problem ? <span className="error">{problem}</span> : null}
      </label>
      <div className="row"><span className="grow" />{onCancel && <button className="btn" onClick={onCancel}>Back</button>}<button className="btn primary" disabled={busy || !invite} onClick={() => void join()} data-testid="join-go">Join</button></div>
    </div>
  );
}

export function ShareSheet() {
  const open = useApp((s) => s.shareOpen);
  const setOpen = useApp((s) => s.setShareOpen);
  const toast = useApp((s) => s.toast);
  const identity = useApp((s) => s.identity);
  const [view, setView] = useState<SharingView | null>(null);
  const [joining, setJoining] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emails, setEmails] = useState("");
  const [service, setService] = useState<MailService>(savedService);

  useEffect(() => {
    if (!open) return;
    setJoining(false);
    const load = () => { if (!REMOTE && !DEMO) engine.share().then(setView).catch(() => undefined); };
    load();
    const t = setInterval(load, 4000);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);
  if (!open) return null;

  const act = async (f: () => Promise<SharingView>) => {
    setBusy(true);
    try {
      setView(await f());
    } catch (err) {
      toast({ kind: "fail", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const link = view?.on ? view.link ?? null : null;
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
  const to = parseEmails(emails);
  const email = () => {
    if (!link || !to) return;
    try {
      localStorage.setItem(SERVICE_KEY, service);
    } catch {
      /* this time only */
    }
    const { subject, body } = inviteMessage(identity.name, link);
    void openExternal(composeUrl(service, to, subject, body))
      .then(() => { setEmails(""); toast({ kind: "ok", text: `Invite ready to send to ${to.join(", ")}` }); })
      .catch(() => toast({ kind: "fail", text: service === "app" ? "No mail app opened. Try Gmail or Outlook, or copy the link." : "Couldn't open your email. Copy the link instead." }));
  };
  const left = view?.invite ? Math.max(1, Math.round((view.invite.expiresAt - Date.now()) / 3600_000)) : 0;

  return (
    <>
      <div className="palette-scrim" onClick={() => setOpen(false)} />
      <section className="palette hermes-sheet share-sheet" role="dialog" aria-label="Share" data-testid="share-sheet">
        <header>
          <span className="hermes-mark" aria-hidden><Users size={18} /></span>
          <div className="grow">
            <h2>{REMOTE ? "Shared board" : joining ? "Join a teammate" : "Invite your team"}</h2>
            <small>{REMOTE ? `You're working on ${REMOTE.label}'s boards` : joining ? "Paste the link they sent you" : "They edit and run these boards from their McBot, live"}</small>
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
            <p className="faint" style={{ margin: 0 }}>Inviting teammates works in the desktop app. Here, open this page in a second tab: both are live.</p>
          </div>
        ) : joining ? (
          <Join onCancel={() => setJoining(false)} />
        ) : (
          <div className="share-body">
            {!view?.on ? (
              <button className="btn primary lg share-create" disabled={busy || !view} onClick={() => void act(() => engine.setShare(true))} data-testid="share-toggle">
                <Link2 size={15} /> Create invite link
              </button>
            ) : (
              <>
                {link && (
                  <div className="share-email">
                    <div className="share-email-row">
                      <Mail size={14} className="faint" />
                      <input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="teammate@company.com" aria-label="Email" data-testid="share-email-to"
                        onKeyDown={(e) => { if (e.key === "Enter") email(); }} />
                      <button className="btn sm primary" disabled={!to} onClick={email} data-testid="share-email">Send invite</button>
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <span className="faint" style={{ fontSize: 12 }}>Send from</span>
                      <div style={{ width: 240 }}><Segmented value={service} onChange={setService} options={MAIL_SERVICES} /></div>
                      {emails.trim() && !to && <span className="error" style={{ fontSize: 12 }}>Check the address</span>}
                    </div>
                  </div>
                )}
                <div className="share-invite" data-testid="share-invite">
                  {link ? (
                    <>
                      <span className="grow mono ellipsis" data-testid="share-link">{link}</span>
                      <button className="btn sm primary" onClick={() => void copy()} data-testid="share-copy">{copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy link"}</button>
                    </>
                  ) : <span className="grow faint">{view.addresses.length ? "The link expired." : "This computer isn't on a network."}</span>}
                </div>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  <button className="btn sm ghost" disabled={busy} onClick={() => void act(() => engine.newInvite())} data-tip="The old link stops working"><RefreshCw size={12} /> New link</button>
                  <span className="grow" />
                  {link && <span className="faint" style={{ fontSize: 12 }}>Works {left}h · same network</span>}
                </div>
                <div className="stack" style={{ gap: 6 }}>
                  <span className="section-label">People</span>
                  {view.members.length === 0 && <span className="faint">Nobody has joined yet.</span>}
                  {view.members.map((m) => (
                    <div key={m.id} className="row">
                      <PersonFace name={m.name} color="#8e8e93" size={22} />
                      <span className="grow">{m.name} <span className="faint">· {Date.now() - m.lastSeen < 120_000 ? "here now" : `seen ${ago(m.lastSeen)}`}</span></span>
                      <button className="btn sm ghost" onClick={() => void act(() => engine.removeMember(m.id))}>Remove</button>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="row">
              <span className="faint" style={{ fontSize: 12 }}>Your keys and files stay on this computer.</span>
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
