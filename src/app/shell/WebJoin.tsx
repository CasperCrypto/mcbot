/**
 * A Share link opened in a web browser: the app, served by the computer that shares
 * (engine/webApp.ts). Say your name and you're in: a teammate gets the app, a guest their chat.
 * Nothing to install, no account. Opened without a link, it asks for one.
 */
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { ShareRole } from "../../contracts/api";
import { Logo } from "../faces/FoodFace";
import { parseInvite, saveRemote } from "../lib/remote";

const NAME_KEY = "mcbot.join.name";
const savedName = () => {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
};

export function WebJoin() {
  const fromLink = new URLSearchParams(location.search).get("code") ?? "";
  const [pasted, setPasted] = useState("");
  const [host, setHost] = useState<string | null>(null);
  const [name, setName] = useState(savedName);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const code = fromLink || parseInvite(pasted)?.code || pasted.trim();

  useEffect(() => {
    document.title = "Join on McBot Studio";
    fetch("/api/share/hello").then((r) => (r.ok ? r.json() : null)).then((h: { host?: string } | null) => setHost(h?.host ?? null)).catch(() => setHost(null));
  }, []);

  const join = async () => {
    if (!code || !name.trim()) return;
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch("/api/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: name.trim() }) });
      const data = (await res.json().catch(() => ({}))) as { key?: string; role?: ShareRole; host?: string; error?: string };
      if (!res.ok || !data.key) throw new Error(data.error ?? `That computer answered ${res.status}`);
      try {
        localStorage.setItem(NAME_KEY, name.trim());
      } catch {
        /* asked again next time */
      }
      saveRemote({ url: location.origin, key: data.key, label: data.host ?? host ?? "Shared", role: data.role ?? "edit" });
      location.replace("/");
    } catch (err) {
      setProblem(err instanceof TypeError ? "Can't reach this McBot. It works while it's open on their computer." : (err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="webjoin" data-testid="web-join">
      <main className="webjoin-card">
        <Logo size={64} />
        <h1>{host ? `Join ${host}` : "You're invited"}</h1>
        <p className="webjoin-sub">{host ? `${host} invited you to their McBot Studio.` : "Open the link you were sent to join."}</p>
        <form className="webjoin-form" onSubmit={(e) => { e.preventDefault(); void join(); }}>
          {!fromLink && (
            <label className="field"><span>Invite link</span>
              <input value={pasted} onChange={(e) => { setPasted(e.target.value); setProblem(null); }} placeholder="Paste the link" autoComplete="off" spellCheck={false} data-testid="web-join-link" />
            </label>
          )}
          <label className="field"><span>Your name</span>
            <input value={name} onChange={(e) => { setName(e.target.value); setProblem(null); }} placeholder="So they know who's here" maxLength={64} autoFocus autoComplete="name" data-testid="web-join-name" />
          </label>
          <button className="btn primary big webjoin-go" type="submit" disabled={busy || !code || !name.trim()} data-testid="web-join-go">
            {busy ? "Joining…" : "Join"} <ArrowRight size={16} />
          </button>
          {problem && <p className="error" role="alert">{problem}</p>}
        </form>
        <small className="webjoin-note">No account, nothing to install.</small>
      </main>
      <a className="webjoin-foot" href="https://mcbot.studio" target="_blank" rel="noreferrer noopener">Made with McBot Studio</a>
    </div>
  );
}
