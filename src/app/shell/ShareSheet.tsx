/**
 * Share on your network: turn sharing on, read out the address and code, see who joined.
 * Join: another computer's address and code. A joined window works on that computer's boards.
 */
import { Check, Copy, LogOut, RefreshCw, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { SharingView } from "../../contracts/api";
import { DEMO, engine, REMOTE } from "../lib/engine";
import { remoteUrl, saveRemote } from "../lib/remote";
import { useApp } from "../state/store";
import { PersonFace } from "../ui";
import { ago } from "../lib/format";

function Join({ onCancel }: { onCancel?: () => void }) {
  const identity = useApp((s) => s.identity);
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const join = async () => {
    if (!address.trim() || !code.trim()) return;
    setBusy(true);
    setProblem(null);
    const url = remoteUrl(address);
    try {
      const res = await fetch(`${url}/api/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: identity.name }) });
      const data = (await res.json().catch(() => ({}))) as { key?: string; error?: string };
      if (!res.ok || !data.key) throw new Error(data.error ?? `That computer answered ${res.status}`);
      saveRemote({ url, key: data.key, label: address.trim() });
      location.reload();
    } catch (err) {
      setProblem(err instanceof TypeError ? "Can't reach that address. Same network? Is sharing on there?" : (err as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="share-body">
      <label className="field"><span>Their address</span>
        <input className="mono" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="192.168.1.20:4318" autoFocus data-testid="join-address" />
      </label>
      <label className="field"><span>Invite code</span>
        <input className="mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="K7Q-4XM" maxLength={8} data-testid="join-code"
          onKeyDown={(e) => { if (e.key === "Enter") void join(); }} />
      </label>
      {problem && <span className="field"><span className="error">{problem}</span></span>}
      <div className="row"><span className="grow" />{onCancel && <button className="btn" onClick={onCancel}>Back</button>}<button className="btn primary" disabled={busy || !address.trim() || !code.trim()} onClick={() => void join()} data-testid="join-go">Join</button></div>
    </div>
  );
}

export function ShareSheet() {
  const open = useApp((s) => s.shareOpen);
  const setOpen = useApp((s) => s.setShareOpen);
  const toast = useApp((s) => s.toast);
  const [view, setView] = useState<SharingView | null>(null);
  const [joining, setJoining] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setJoining(false);
    if (!REMOTE) engine.share().then(setView).catch(() => undefined);
    const t = setInterval(() => { if (!REMOTE) engine.share().then(setView).catch(() => undefined); }, 4000);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);
  if (!open) return null;

  const act = async (f: () => Promise<SharingView>) => {
    try {
      setView(await f());
    } catch (err) {
      toast({ kind: "fail", text: (err as Error).message });
    }
  };
  const invite = view?.invite && view.addresses[0] ? `${view.addresses[0]}  ·  ${view.invite.code}` : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Join my McBot board: ⌘K → Join a shared board\nAddress: ${view?.addresses[0] ?? ""}\nCode: ${view?.invite?.code ?? ""}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* select and copy by hand */
    }
  };

  return (
    <>
      <div className="palette-scrim" onClick={() => setOpen(false)} />
      <section className="palette hermes-sheet share-sheet" role="dialog" aria-label="Share" data-testid="share-sheet">
        <header>
          <span className="hermes-mark" aria-hidden><Users size={18} /></span>
          <div className="grow">
            <h2>{REMOTE ? "Shared board" : joining ? "Join a shared board" : "Share on your network"}</h2>
            <small>{REMOTE ? `You're working on ${REMOTE.label}'s boards` : joining ? "Same Wi-Fi or office network" : "Teammates edit and run these boards from their McBot, live"}</small>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}><X size={15} /></button>
        </header>

        {REMOTE ? (
          <div className="share-body">
            <p className="faint" style={{ margin: 0 }}>Agents run on their computer, with their keys.</p>
            <div className="row"><span className="grow" /><button className="btn" onClick={() => { saveRemote(null); location.reload(); }} data-testid="share-leave"><LogOut size={13} /> Leave and go back to mine</button></div>
          </div>
        ) : joining || DEMO ? (
          DEMO ? (
            <div className="share-body">
              <p className="faint" style={{ margin: 0 }}>Sharing between computers works in the desktop app. Here, open this page in a second tab: both are live.</p>
            </div>
          ) : <Join onCancel={() => setJoining(false)} />
        ) : (
          <div className="share-body">
            <label className="share-toggle">
              <input type="checkbox" checked={!!view?.on} onChange={(e) => void act(() => engine.setShare(e.target.checked))} data-testid="share-toggle" />
              <span className="grow"><b>Share my boards</b><br /><span className="faint">Only people with a code can join. Your keys and files stay here.</span></span>
            </label>
            {view?.on && (
              <>
                <div className="share-invite" data-testid="share-invite">
                  {view.invite && view.addresses.length ? (
                    <>
                      <span className="grow mono">{invite}</span>
                      <button className="btn sm" onClick={() => void copy()}>{copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}</button>
                    </>
                  ) : <span className="grow faint">{view.addresses.length ? "Code used. Make a new one for the next teammate." : "No network found on this computer."}</span>}
                  <button className="icon-btn sm" aria-label="New code" data-tip="New code (15 minutes, one person)" onClick={() => void act(() => engine.newInvite())}><RefreshCw size={13} /></button>
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
            <div className="row"><span className="grow" /><button className="btn ghost sm" onClick={() => setJoining(true)} data-testid="share-join">Join someone else's</button></div>
          </div>
        )}
      </section>
    </>
  );
}
