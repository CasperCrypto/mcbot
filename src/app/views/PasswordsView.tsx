/**
 * Passwords: the person's logins to websites (for the Browser: copy, or fill on that site) and
 * the API keys agents use, in one place. Logins are sealed by the engine (engine/logins.ts) and a
 * password reaches this window only when it is copied or filled; keys are names only here, as in
 * Settings. Neither ever reaches someone who joined.
 */
import { Check, Copy, Eye, EyeOff, Globe, KeyRound, Pencil, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { LoginView } from "../../contracts/api";
import { LogoTile } from "../graph/Logo";
import { siteLogo } from "../lib/browserStore";
import { engine, REMOTE } from "../lib/engine";
import { ago } from "../lib/format";
import { useApp } from "../state/store";
import { SkeletonCards } from "../ui";
import { KeysSection } from "./SettingsView";

/** A strong password: 20 characters from letters, digits and a few symbols that every site accepts. */
export function newPassword(length = 20): string {
  const set = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_.!@#";
  const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
  let out = "";
  for (const b of bytes) {
    if (b < 256 - (256 % set.length)) out += set[b % set.length];
    if (out.length === length) break;
  }
  return out;
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    useApp.getState().toast({ kind: "ok", text: `${what} copied` });
  } catch {
    useApp.getState().toast({ kind: "fail", text: "Couldn't copy" });
  }
}

function LoginForm({ login, onDone }: { login: LoginView | null; onDone: (list?: LoginView[]) => void }) {
  const [url, setUrl] = useState(login?.url ?? "");
  const [username, setUsername] = useState(login?.username ?? "");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const r = await engine.saveLogin({ id: login?.id, url, username, ...(password ? { password } : {}) });
      onDone(r.logins);
    } catch (err) {
      setProblem((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <form className="pw-form" onSubmit={(e) => { e.preventDefault(); void save(); }} data-testid="login-form">
      <label className="field"><span>Site</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="mail.google.com" autoFocus={!login} spellCheck={false} data-testid="login-url" /></label>
      <label className="field"><span>User name or email</span><input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" spellCheck={false} data-testid="login-user" /></label>
      <label className="field"><span>Password</span>
        <span className="pw-secret">
          <input type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={login ? "Unchanged" : ""} autoComplete="new-password" data-testid="login-password" />
          <button type="button" className="icon-btn sm" aria-label={show ? "Hide" : "Show"} onClick={() => setShow(!show)}>{show ? <EyeOff size={13} /> : <Eye size={13} />}</button>
          <button type="button" className="btn sm ghost" onClick={() => { setPassword(newPassword()); setShow(true); }} data-tip="Make a strong one"><Sparkles size={12} /> Strong</button>
        </span>
      </label>
      {problem && <span className="error">{problem}</span>}
      <div className="row"><span className="grow" /><button type="button" className="btn" onClick={() => onDone()}>Cancel</button>
        <button className="btn primary" disabled={busy || !url.trim() || (!login && !password)} data-testid="login-save">{login ? "Save" : "Add login"}</button></div>
    </form>
  );
}

function LoginRow({ l, onEdit, onRemoved }: { l: LoginView; onEdit: () => void; onRemoved: (list: LoginView[]) => void }) {
  const [sure, setSure] = useState(false);
  const [copied, setCopied] = useState(false);
  const logo = siteLogo(l.url);
  const copyPassword = async () => {
    try {
      const r = await engine.revealLogin(l.id);
      await navigator.clipboard.writeText(r.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      useApp.getState().toast({ kind: "fail", text: (err as Error).message });
    }
  };
  return (
    <div className="pw-row" data-testid="login-row">
      {logo ? <LogoTile logo={logo} kind="site" sm><Globe size={12} /></LogoTile> : <span className="tile sm site-letter">{l.host[0]?.toUpperCase()}</span>}
      <span className="pw-row-main">
        <b className="ellipsis">{l.host.replace(/^www\./, "")}</b>
        <span className="faint ellipsis">{l.username || "No user name"}</span>
      </span>
      <span className="faint pw-when">{ago(l.updatedAt)}</span>
      {l.username && <button className="btn sm ghost" onClick={() => void copy(l.username, "User name")} data-tip="Copy user name"><Copy size={12} /> Name</button>}
      <button className="btn sm" onClick={() => void copyPassword()} data-testid="login-copy">{copied ? <Check size={12} /> : <KeyRound size={12} />} {copied ? "Copied" : "Password"}</button>
      <button className="icon-btn sm" aria-label="Edit" data-tip="Edit" onClick={onEdit}><Pencil size={13} /></button>
      <button className={`icon-btn sm${sure ? " danger" : ""}`} aria-label="Remove" data-tip={sure ? "Click again to remove" : "Remove"} onBlur={() => setSure(false)}
        onClick={() => { if (!sure) return setSure(true); void engine.removeLogin(l.id).then((r) => onRemoved(r.logins)); }}><Trash2 size={13} /></button>
    </div>
  );
}

export function PasswordsView() {
  const [list, setList] = useState<LoginView[] | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<LoginView | "new" | null>(null);
  useEffect(() => {
    if (REMOTE) return;
    engine.logins().then((r) => setList(r.logins)).catch(() => setList([]));
  }, []);
  const shown = useMemo(() => (list ?? []).filter((l) => !query.trim() || `${l.host} ${l.username}`.toLowerCase().includes(query.trim().toLowerCase())), [list, query]);

  if (REMOTE) return <section className="main frame passwords-view"><div className="empty"><KeyRound size={28} className="faint" /><p>Passwords stay on each person's own computer.</p></div></section>;
  return (
    <section className="main frame passwords-view" data-testid="passwords-view">
      <div className="pw-page">
        <header className="pw-head">
          <h1>Passwords</h1>
          <span className="faint">Kept on this computer. Never shared with people you invite.</span>
        </header>

        <section className="card pw-card">
          <div className="pw-card-head">
            <b>Logins</b>
            <span className="faint pw-count">{list ? list.length : ""}</span>
            <label className="pw-search"><Search size={13} className="faint" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search logins" /></label>
            <button className="btn sm primary" onClick={() => setEditing("new")} data-testid="login-new"><Plus size={13} /> New login</button>
          </div>
          {editing === "new" && <LoginForm login={null} onDone={(l) => { if (l) setList(l); setEditing(null); }} />}
          {list === null ? <SkeletonCards count={2} /> : list.length === 0 && editing !== "new" ? (
            <p className="pw-empty faint">Save a site's login here, then fill it in the Browser with one click.</p>
          ) : (
            <div className="pw-list">
              {shown.map((l) => editing && editing !== "new" && editing.id === l.id
                ? <LoginForm key={l.id} login={l} onDone={(next) => { if (next) setList(next); setEditing(null); }} />
                : <LoginRow key={l.id} l={l} onEdit={() => setEditing(l)} onRemoved={setList} />)}
              {query && shown.length === 0 && <p className="pw-empty faint">No login matches "{query}". <button className="link-btn" onClick={() => setQuery("")}><X size={11} /> Clear</button></p>}
            </div>
          )}
        </section>

        <KeysSection />
      </div>
    </section>
  );
}
