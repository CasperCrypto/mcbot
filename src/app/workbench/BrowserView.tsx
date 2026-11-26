import { ArrowLeft, ArrowRight, ExternalLink, Globe, House, KeyRound, LoaderCircle, RotateCw, Star, WifiOff, MessageSquare } from "lucide-react";
import { uiZoom } from "../lib/appearance";
import type { LoginView } from "../../contracts/api";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentNode } from "../../contracts/graph";
import { runAgent } from "../actions";
import { nativePage, openBrowser, page, type PageBox } from "../lib/desktop";
import { DEMO, engine, REMOTE } from "../lib/engine";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { addRecent, isFavorite, loadFavorites, toggleFavorite, type Site } from "../lib/browserStore";
import { BrowserStart } from "./BrowserStart";

import { framedUrl, toUrl } from "../lib/pageUrl";
import { useLayersOver } from "../lib/layers";
import { agentOptions } from "../lib/agentOptions";
import { Picker } from "../Picker";

const hostOf = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};

/** One click asks the agent about the page. */
const QUICK = [
  { label: "Summarize", ask: "Summarize this page in a few bullet points." },
  { label: "Key facts", ask: "List the key facts, numbers and dates on this page." },
  { label: "Translate", ask: "Translate this page into English, keeping its structure." },
];
const isLocal = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(u);

/** The page this window last showed: coming back to Browser shows it again. */
let remembered: { history: string[]; at: number } = { history: [], at: -1 };

/**
 * The workbench browser: look at a page next to your agents, then hand it to one. In the desktop
 * app on macOS and Windows the page is a real webview over the page area (src-tauri/src/browser.rs),
 * so every site loads. Elsewhere it is an iframe: the engine first asks whether the site allows
 * being framed, and a site that refuses gets a card that opens it in a window instead of a blank
 * page. Agents browse with their own browser tool (Hermes' Chromium), which "Ask" uses.
 */
export default function BrowserView() {
  const { boardId, graph } = useBoard();
  const agents = useMemo(() => graph.nodes.filter((n): n is AgentNode => n.kind === "agent"), [graph]);
  const [history, setHistory] = useState<string[]>(remembered.history);
  const [at, setAt] = useState(remembered.at);
  const [input, setInput] = useState(remembered.history[remembered.at] ?? "");
  const [reload, setReload] = useState(0);
  const [question, setQuestion] = useState("");
  const [agentId, setAgentId] = useState<string>("");
  /** The native page could not be made: this window uses the iframe from now on. */
  const [nativeFailed, setNativeFailed] = useState(false);
  /** Whether the site lets itself be framed (iframe mode only); null while asking. */
  const [frameOk, setFrameOk] = useState<Record<string, boolean>>({});
  /** Whether each page answers (asked of the engine): false shows McBot's own "can't reach" screen. */
  const [reach, setReach] = useState<Record<string, boolean>>({});
  /** Where the native page is now (links clicked inside it move it). */
  const [live, setLive] = useState<string | null>(null);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [favorites, setFavorites] = useState<Site[]>(loadFavorites);
  /** Saved logins for the page's site (Passwords), and whether their menu is open. */
  const [logins, setLogins] = useState<LoginView[]>([]);
  const [keysOpen, setKeysOpen] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const native = useMemo(() => nativePage(), []) && !nativeFailed;
  const url = at >= 0 ? history[at] ?? null : null;
  // A native page draws above the window's HTML, so it steps aside while anything floats over it: a
  // sheet or ⌘K, a pop-up menu (the agent picker below it), a side panel, the island opening or
  // showing a notice (lib/layers.ts finds them all).
  const sheet = useApp((s) => s.paletteOpen || s.compileOpen || s.hermesOpen || s.reportOpen || s.newAgentOpen || s.catalogOpen || s.chatAppsOpen || s.teamOpen || s.teamsOpen || s.shareOpen || s.folderPickerOpen);
  const layered = useLayersOver(area, native && !!url);
  const covered = sheet || layered;
  useEffect(() => {
    remembered = { history, at };
    setLive(null);
  }, [history, at]);
  // The page on screen: where the native page went, else the address asked for.
  const shown = (native ? live : null) ?? url;
  // Where the native page is now, for coming back after something covered it (not the address it
  // started from, or every closed menu would undo the links followed inside the page).
  const liveRef = useRef<string | null>(null);
  liveRef.current = live;
  // Every page shown joins the start page's recent list.
  useEffect(() => {
    if (shown) addRecent(shown);
  }, [shown]);
  // The saved logins for this site, offered from the address bar.
  // Logins are kept by host name, without the port (engine/logins.ts loginSite).
  const site = (() => {
    try {
      return shown ? new URL(shown).hostname : "";
    } catch {
      return "";
    }
  })();
  useEffect(() => {
    setKeysOpen(false);
    if (!site || REMOTE) return setLogins([]);
    let alive = true;
    engine.logins(site).then((r) => { if (alive) setLogins(r.logins); }).catch(() => { if (alive) setLogins([]); });
    return () => {
      alive = false;
    };
  }, [site]);
  const applyLogin = async (l: LoginView, how: "fill" | "copy") => {
    try {
      const r = await engine.revealLogin(l.id);
      setKeysOpen(false);
      if (how === "copy") {
        await navigator.clipboard.writeText(r.password);
        useApp.getState().toast({ kind: "ok", text: `Password for ${r.host} copied` });
      } else {
        await page.fill(r.host, r.username, r.password);
      }
    } catch (err) {
      useApp.getState().toast({ kind: "fail", text: String(err instanceof Error ? err.message : err) });
    }
  };
  // Back to the start page: the native page steps aside.
  useEffect(() => {
    if (native && !url) void page.hide();
  }, [native, url]);
  // The window's own idea of being online, and whether the page answers: either one failing shows
  // McBot's own screen instead of the web engine's error page (on Windows that page is Edge's).
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  useEffect(() => {
    if (!shown || REMOTE || shown in reach) return;
    let alive = true;
    void engine.frameable(shown)
      .then((r) => { if (alive) { setReach((m) => ({ ...m, [shown]: r.reachable !== false })); setFrameOk((m) => (shown in m ? m : { ...m, [shown]: r.frameable })); } })
      // The engine didn't answer: let the page try (and the frame decide) rather than wait forever.
      .catch(() => { if (alive) { setReach((m) => ({ ...m, [shown]: true })); setFrameOk((m) => (shown in m ? m : { ...m, [shown]: true })); } });
    return () => {
      alive = false;
    };
  }, [shown, reach]);
  const unreachable = !!shown && (!online || reach[shown] === false);
  const retry = () => {
    if (!shown) return;
    setOnline(navigator.onLine);
    setReach((m) => {
      const next = { ...m };
      delete next[shown];
      return next;
    });
    if (native) void page.go("reload");
    else setReload((n) => n + 1);
  };

  // The native page is placed in the window's own units: with the app zoomed (Settings → Size),
  // a CSS pixel is `uiZoom()` of them.
  const box = (): PageBox | null => {
    const r = area.current?.getBoundingClientRect();
    const z = uiZoom();
    return r && r.width > 0 && r.height > 0 ? { x: r.left * z, y: r.top * z, w: r.width * z, h: r.height * z } : null;
  };

  // Desktop: show the address in the page, placed over the page area. The area may not have its
  // final size and place on the first frame (layout, the view's entry motion), so it is measured
  // again for a few frames; a failure falls back to the iframe for this window.
  useEffect(() => {
    if (!native || !url) return;
    if (covered || keysOpen || unreachable) {
      void page.hide();
      return;
    }
    let alive = true;
    let raf = 0;
    const show = async (tries: number) => {
      const b = box();
      if (!b) {
        if (tries > 0 && alive) raf = requestAnimationFrame(() => void show(tries - 1));
        return;
      }
      try {
        await page.show(liveRef.current ?? url, b);
      } catch (err) {
        if (!alive) return;
        setNativeFailed(true);
        useApp.getState().toast({ kind: "fail", text: `The page couldn't open here: ${String(err)}`, action: { label: "Open in your browser", run: () => void openBrowser(url) } });
      }
    };
    void show(30);
    const settle = [80, 250, 500].map((ms) => setTimeout(() => { const b = box(); if (b && alive) void page.bounds(b); }, ms));
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      settle.forEach(clearTimeout);
    };
  }, [native, url, reload, covered, keysOpen, unreachable]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!native || !area.current) return;
    const sync = () => {
      const b = box();
      if (b) void page.bounds(b);
    };
    const ro = new ResizeObserver(sync);
    ro.observe(area.current);
    window.addEventListener("resize", sync);
    // Moves that change no size (the view's entry motion, a sidebar sliding) end in these.
    document.addEventListener("animationend", sync, true);
    document.addEventListener("transitionend", sync, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
      document.removeEventListener("animationend", sync, true);
      document.removeEventListener("transitionend", sync, true);
    };
  }, [native, url !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!native) return;
    let off: (() => void) | null = null;
    let alive = true;
    // Links clicked inside the page move the address bar too.
    void page.onUrl((u) => { setInput(u); setLive(u); }).then((f) => {
      if (alive) off = f;
      else f();
    });
    return () => {
      alive = false;
      off?.();
      void page.hide();
    };
  }, [native]);


  const go = (raw: string) => {
    if (!raw.trim()) return;
    const u = toUrl(raw);
    const next = [...history.slice(0, at + 1), u];
    setHistory(next);
    setAt(next.length - 1);
    setInput(u);
  };
  const step = (d: number) => {
    if (native) {
      void page.go(d < 0 ? "back" : "forward");
      return;
    }
    const i = Math.max(0, Math.min(history.length - 1, at + d));
    setAt(i);
    setInput(history[i]!);
  };
  const openOutside = () => url && void openBrowser(url).catch((err: unknown) => useApp.getState().toast({ kind: "fail", text: String(err) }));
  const ask = async (preset?: string) => {
    const agent = agents.find((a) => a.id === (agentId || agents[0]?.id));
    const q = (preset ?? question).trim();
    if (!agent || !shown || !q) return;
    const runId = await runAgent(boardId, agent.id, `${q}\n\nPage: ${shown}\n(Open it with your browser tool.)`);
    if (runId) {
      setQuestion("");
      useApp.getState().toast({ kind: "ok", text: `Asked ${agent.data.displayName || agent.data.name}`, action: { label: "Open", run: () => useApp.getState().openChat(agent.id) } });
    }
  };

  const verdict = url && !native ? (isLocal(url) || REMOTE ? true : frameOk[url]) : undefined;
  return (
    <section className="main flush-left browser-main" data-testid="browser-view">
      <div className="browser-bar">
        <button className="icon-btn sm" aria-label="Back" disabled={native ? !url : at <= 0} onClick={() => step(-1)}><ArrowLeft size={14} /></button>
        <button className="icon-btn sm" aria-label="Forward" disabled={native ? !url : at >= history.length - 1} onClick={() => step(1)}><ArrowRight size={14} /></button>
        <button className="icon-btn sm" aria-label="Reload" disabled={!url} onClick={() => (native ? void page.go("reload") : setReload((n) => n + 1))}><RotateCw size={13} /></button>
        <button className="icon-btn sm" aria-label="Start page" data-tip="Start page" disabled={!url} onClick={() => { setAt(-1); setInput(""); }} data-testid="browser-home"><House size={13} /></button>
        <label className="browser-url">
          <Globe size={13} className="faint" />
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") go(input); }}
            onFocus={(e) => e.target.select()} placeholder="Search or enter an address" aria-label="Address" data-testid="browser-address" />
          {shown && !REMOTE && (
            <button className={`browser-key${logins.length ? " has" : ""}${keysOpen ? " on" : ""}`} aria-label="Passwords for this site" aria-expanded={keysOpen}
              data-tip={logins.length ? `${logins.length} saved login${logins.length === 1 ? "" : "s"}` : "Passwords"} onClick={(e) => { e.preventDefault(); setKeysOpen(!keysOpen); }} data-testid="browser-key">
              <KeyRound size={13} />
            </button>
          )}
          {shown && (
            <button className={`browser-star${isFavorite(favorites, shown) ? " on" : ""}`} aria-label={isFavorite(favorites, shown) ? "Remove from favorites" : "Add to favorites"}
              data-tip={isFavorite(favorites, shown) ? "In favorites" : "Add to favorites"} onClick={(e) => { e.preventDefault(); setFavorites(toggleFavorite(favorites, shown)); }} data-testid="browser-star">
              <Star size={13} />
            </button>
          )}
        </label>
        <button className="icon-btn sm" aria-label="Open in your browser" data-tip="Open in your browser" disabled={!url} onClick={openOutside}><ExternalLink size={13} /></button>
      </div>
      {keysOpen && shown && (
        <div className="browser-keys glass" role="menu" data-testid="browser-keys">
          <div className="browser-keys-head"><KeyRound size={13} /><b>{site.replace(/^www\./, "")}</b></div>
          {logins.length === 0 ? <p className="faint">No saved login for this site.</p> : logins.map((l) => (
            <div key={l.id} className="browser-keys-row">
              <span className="grow ellipsis">{l.username || "No user name"}</span>
              {native && <button className="btn sm primary" onClick={() => void applyLogin(l, "fill")} data-testid="browser-fill">Fill</button>}
              <button className="btn sm" onClick={() => void applyLogin(l, "copy")}>Copy password</button>
            </div>
          ))}
          <button className="link-btn" onClick={() => { setKeysOpen(false); useApp.getState().setTab("passwords"); }}>{logins.length ? "Manage passwords" : "Save a login in Passwords"}</button>
        </div>
      )}
      <div className="browser-page">
        {unreachable ? (
          // McBot's own screen, never the web engine's error page.
          <div className="browser-demo" data-testid="browser-unreachable">
            {online ? <Globe size={28} className="faint" /> : <WifiOff size={28} className="faint" />}
            <b>{online ? `Can't reach ${hostOf(shown!)}` : "You're offline"}</b>
            <span className="faint">{online ? "Check the address, or try again in a moment." : "Pages open again when the connection is back."}</span>
            <div className="row" style={{ justifyContent: "center" }}>
              <button className="btn light" onClick={retry} data-testid="browser-retry"><RotateCw size={14} /> Try again</button>
              {online && <button className="btn" onClick={openOutside}><ExternalLink size={14} /> Open in your browser</button>}
            </div>
          </div>
        ) : url && native ? (
          <div ref={area} className="browser-native" data-testid="browser-native">
            {covered && <div className="browser-held" aria-hidden="true"><Globe size={26} /><span>{site}</span></div>}
          </div>
        ) : url && verdict === undefined ? (
          <div className="browser-demo"><LoaderCircle size={22} className="spin-icon faint" /></div>
        ) : url && verdict === false ? (
          // The site forbids being shown inside another page: say so, and open it where it works.
          <div className="browser-demo" data-testid="browser-blocked">
            <Globe size={28} className="faint" />
            <b>{new URL(url).host}</b>
            <span className="faint">{DEMO ? "Websites can't open inside a web page, so the online demo can't show this site. In the McBot Studio app it opens right here." : "This site doesn't allow being shown inside other apps."}</span>
            <div className="row" style={{ justifyContent: "center" }}>
              <button className="btn light" onClick={openOutside} data-testid="browser-open-window"><ExternalLink size={14} /> Open in your browser</button>
              {agents.length > 0 && <span className="faint">or ask an agent about it below</span>}
            </div>
          </div>
        ) : url ? (
          <iframe key={`${url}#${reload}`} src={framedUrl(url)} title="Page" sandbox="allow-scripts allow-forms allow-popups allow-same-origin allow-downloads" referrerPolicy="no-referrer" data-testid="browser-frame" />
        ) : (
          <BrowserStart onGo={go} favorites={favorites} onFavorites={setFavorites} />
        )}
      </div>
      {url && agents.length > 0 && (
        <div className="code-ask browser-ask">
          <MessageSquare size={13} className="faint" />
          <Picker sm label="Agent" value={agentId || agents[0]!.id} onChange={setAgentId} options={agentOptions(agents)} />
          <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about this page: find the price, fill the form…"
            onKeyDown={(e) => { if (e.key === "Enter") void ask(); }} data-testid="browser-ask" />
          <div className="browser-quick">
            {QUICK.map((q) => <button key={q.label} className="chip" onClick={() => void ask(q.ask)} data-tip={q.ask}>{q.label}</button>)}
          </div>
        </div>
      )}
    </section>
  );
}
