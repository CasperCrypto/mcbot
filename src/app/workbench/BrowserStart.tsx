/**
 * The browser's start page: one big field (an address or a search), favorites as brand tiles,
 * what is running on this computer (a dev server, a local model's page) and the pages visited
 * last. Favorites and recent pages stay on this computer (lib/browserStore.ts).
 */
import { Clock, Globe, Plus, Search, Server, Star, X } from "lucide-react";
import { useEffect, useState } from "react";
import { LogoTile } from "../graph/Logo";
import { ago } from "../lib/format";
import { DEMO, engine, REMOTE } from "../lib/engine";
import { clearRecent, loadFavorites, loadRecent, saveFavorites, siteLogo, siteName, type Site } from "../lib/browserStore";

/** Where a local dev server or tool usually listens. */
const LOCAL = ["http://localhost:3000", "http://localhost:5173", "http://localhost:4200", "http://localhost:8000", "http://localhost:8080", "http://localhost:8888"];

function SiteTile({ url, title, sm }: { url: string; title: string; sm?: boolean }) {
  const logo = siteLogo(url);
  return logo ? <LogoTile logo={logo} kind="site" sm={sm}><Globe size={sm ? 12 : 16} /></LogoTile>
    : <span className={`tile site-letter${sm ? " sm" : ""}`} aria-hidden>{(title.trim()[0] ?? "?").toUpperCase()}</span>;
}

export function BrowserStart({ onGo, favorites, onFavorites }: { onGo: (input: string) => void; favorites: Site[]; onFavorites: (list: Site[]) => void }) {
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<Site[]>(loadRecent);
  const [adding, setAdding] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [running, setRunning] = useState<string[]>([]);
  // What answers on the usual local ports (asked of the engine, which may reach localhost).
  useEffect(() => {
    if (REMOTE || DEMO) return;
    let alive = true;
    for (const u of LOCAL) {
      void engine.frameable(u).then((r) => { if (alive && r.reachable !== false) setRunning((list) => (list.includes(u) ? list : [...list, u].sort())); }).catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, []);
  const add = () => {
    const v = newUrl.trim();
    if (!v) return setAdding(false);
    const url = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    onFavorites(saveFavorites([...favorites, { url, title: siteName(url).split(".")[0]!.replace(/^./, (c) => c.toUpperCase()) }]));
    setNewUrl("");
    setAdding(false);
  };
  return (
    <div className="bstart" data-testid="browser-start">
      <form className="bstart-search" onSubmit={(e) => { e.preventDefault(); if (query.trim()) onGo(query); }}>
        <Search size={18} className="faint" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the web or enter an address" aria-label="Search or address" autoFocus data-testid="browser-start-search" />
        <kbd className="faint">↵</kbd>
      </form>

      <section className="bstart-section">
        <h4><Star size={12} /> Favorites</h4>
        <div className="bstart-grid">
          {favorites.map((f) => (
            <div key={f.url} className="bstart-fav">
              <button className="bstart-fav-open" onClick={() => onGo(f.url)} data-tip={f.url} data-testid="browser-fav">
                <SiteTile url={f.url} title={f.title} />
                <span className="ellipsis">{f.title}</span>
              </button>
              <button className="bstart-fav-x" aria-label={`Remove ${f.title}`} onClick={() => onFavorites(saveFavorites(favorites.filter((x) => x.url !== f.url)))}><X size={10} /></button>
            </div>
          ))}
          {adding ? (
            <form className="bstart-add-form" onSubmit={(e) => { e.preventDefault(); add(); }}>
              <input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="linear.app" autoFocus aria-label="Address to add" onBlur={add} onKeyDown={(e) => { if (e.key === "Escape") setAdding(false); }} />
            </form>
          ) : (
            <button className="bstart-fav-open bstart-add" onClick={() => setAdding(true)} data-tip="Add a favorite">
              <span className="tile site-letter"><Plus size={16} /></span>
              <span>Add</span>
            </button>
          )}
        </div>
      </section>

      {running.length > 0 && (
        <section className="bstart-section">
          <h4><Server size={12} /> On this computer</h4>
          <div className="bstart-chips">
            {running.map((u) => <button key={u} className="bstart-chip" onClick={() => onGo(u)}><span className="bstart-live" aria-hidden />{u.replace(/^https?:\/\//, "")}</button>)}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section className="bstart-section">
          <h4><Clock size={12} /> Recently visited <span className="grow" /><button className="link-btn" onClick={() => { clearRecent(); setRecent([]); }}>Clear</button></h4>
          <div className="bstart-recent">
            {recent.slice(0, 8).map((r) => (
              <button key={r.url} className="bstart-row" onClick={() => onGo(r.url)} data-testid="browser-recent">
                <SiteTile url={r.url} title={r.title} sm />
                <span className="bstart-row-title">{r.title}</span>
                <span className="faint ellipsis grow">{r.url.replace(/^https?:\/\/(www\.)?/, "").replace(/^[^/]+/, "") || "/"}</span>
                {r.at ? <span className="faint num">{ago(r.at)}</span> : null}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
