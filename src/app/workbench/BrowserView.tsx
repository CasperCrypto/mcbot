import { ArrowLeft, ArrowRight, ExternalLink, Globe, LoaderCircle, RotateCw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentNode } from "../../contracts/graph";
import { runAgent } from "../actions";
import { nativePage, openBrowser, page, type PageBox } from "../lib/desktop";
import { DEMO, engine, REMOTE } from "../lib/engine";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { AgentFace, Empty } from "../ui";

/** "localhost:3000" → "http://localhost:3000"; "mcbot docs" → a search. */
export function toUrl(input: string): string {
  const v = input.trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(v)) return `http://${v}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(v)) return `https://${v}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(v)}`;
}

const START = ["localhost:3000", "localhost:5173", "news.ycombinator.com", "en.wikipedia.org"];
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
  const area = useRef<HTMLDivElement>(null);
  const native = useMemo(() => nativePage(), []) && !nativeFailed;
  // A native page draws above the window's HTML, so it steps aside while a sheet or ⌘K is open.
  const covered = useApp((s) => s.paletteOpen || s.compileOpen || s.hermesOpen || s.reportOpen || s.newAgentOpen || s.catalogOpen || s.chatAppsOpen || s.teamOpen || s.teamsOpen || s.shareOpen || s.folderPickerOpen);
  const url = at >= 0 ? history[at] ?? null : null;
  useEffect(() => {
    remembered = { history, at };
  }, [history, at]);

  const box = (): PageBox | null => {
    const r = area.current?.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
  };

  // Desktop: show the address in the page, placed over the page area. The area may not have its
  // final size and place on the first frame (layout, the view's entry motion), so it is measured
  // again for a few frames; a failure falls back to the iframe for this window.
  useEffect(() => {
    if (!native || !url) return;
    if (covered) {
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
        await page.show(url, b);
      } catch (err) {
        if (!alive) return;
        setNativeFailed(true);
        useApp.getState().toast({ kind: "fail", text: `The page couldn't open here: ${String(err)}`, action: { label: "Open in a window", run: () => void openBrowser(url) } });
      }
    };
    void show(30);
    const settle = [80, 250, 500].map((ms) => setTimeout(() => { const b = box(); if (b && alive) void page.bounds(b); }, ms));
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      settle.forEach(clearTimeout);
    };
  }, [native, url, reload, covered]); // eslint-disable-line react-hooks/exhaustive-deps
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
    void page.onUrl((u) => setInput(u)).then((f) => {
      if (alive) off = f;
      else f();
    });
    return () => {
      alive = false;
      off?.();
      void page.hide();
    };
  }, [native]);

  // Iframe mode: ask once per address whether the site allows it (localhost always tries).
  useEffect(() => {
    if (native || !url || isLocal(url) || url in frameOk || REMOTE) return;
    let alive = true;
    void engine.frameable(url).then((r) => { if (alive) setFrameOk((m) => ({ ...m, [url]: r.frameable })); }).catch(() => { if (alive) setFrameOk((m) => ({ ...m, [url]: true })); });
    return () => {
      alive = false;
    };
  }, [native, url, frameOk]);

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
  const ask = async () => {
    const agent = agents.find((a) => a.id === (agentId || agents[0]?.id));
    if (!agent || !url || !question.trim()) return;
    const runId = await runAgent(boardId, agent.id, `${question.trim()}\n\nPage: ${url}\n(Open it with your browser tool.)`);
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
        <label className="browser-url">
          <Globe size={13} className="faint" />
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") go(input); }}
            onFocus={(e) => e.target.select()} placeholder="Search or enter an address" aria-label="Address" data-testid="browser-address" />
        </label>
        <button className="icon-btn sm" aria-label="Open in a window" data-tip="Open in a window" disabled={!url} onClick={openOutside}><ExternalLink size={13} /></button>
      </div>
      <div className="browser-page">
        {url && native ? (
          <div ref={area} className="browser-native" data-testid="browser-native" />
        ) : url && verdict === undefined ? (
          <div className="browser-demo"><LoaderCircle size={22} className="spin-icon faint" /></div>
        ) : url && verdict === false ? (
          // The site forbids being shown inside another page: say so, and open it where it works.
          <div className="browser-demo" data-testid="browser-blocked">
            <Globe size={28} className="faint" />
            <b>{new URL(url).host}</b>
            <span className="faint">{DEMO ? "Websites can't open inside a web page, so the online demo can't show this site. In the McBot app it opens right here." : "This site doesn't allow being shown inside other apps."}</span>
            <div className="row" style={{ justifyContent: "center" }}>
              <button className="btn light" onClick={openOutside} data-testid="browser-open-window"><ExternalLink size={14} /> Open in a window</button>
              {agents.length > 0 && <span className="faint">or ask an agent about it below</span>}
            </div>
          </div>
        ) : url ? (
          <iframe key={`${url}#${reload}`} src={url} title="Page" sandbox="allow-scripts allow-forms allow-popups allow-same-origin allow-downloads" referrerPolicy="no-referrer" data-testid="browser-frame" />
        ) : (
          <Empty title="Browse next to your agents" action={
            <div className="row" style={{ flexWrap: "wrap", justifyContent: "center" }}>
              {START.map((s) => <button key={s} className="btn sm" onClick={() => go(s)}>{s}</button>)}
            </div>
          } />
        )}
      </div>
      {url && agents.length > 0 && (
        <div className="code-ask browser-ask">
          <Sparkles size={13} className="faint" />
          <select value={agentId || agents[0]!.id} onChange={(e) => setAgentId(e.target.value)} aria-label="Agent">
            {agents.map((a) => <option key={a.id} value={a.id}>{a.data.displayName || a.data.name}</option>)}
          </select>
          <AgentFace seed={agents.find((a) => a.id === (agentId || agents[0]!.id))?.data.name ?? "agent"} size={20} />
          <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about this page: summarise it, find the price, fill the form…"
            onKeyDown={(e) => { if (e.key === "Enter") void ask(); }} data-testid="browser-ask" />
        </div>
      )}
    </section>
  );
}
