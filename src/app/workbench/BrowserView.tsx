import { ArrowLeft, ArrowRight, ExternalLink, Globe, RotateCw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentNode } from "../../contracts/graph";
import { runAgent } from "../actions";
import { nativePage, openBrowser, page, type PageBox } from "../lib/desktop";
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

/**
 * The workbench browser: look at a page next to your agents, then hand it to one. In the desktop
 * app the page is a real webview over the page area (src-tauri/src/browser.rs), so every site
 * loads; in a browser tab (the demo) it is an iframe, and sites that refuse framing open in a new
 * tab. Agents browse with their own browser tool (Hermes' Chromium), which "Ask" uses.
 */
export default function BrowserView() {
  const { boardId, graph } = useBoard();
  const agents = useMemo(() => graph.nodes.filter((n): n is AgentNode => n.kind === "agent"), [graph]);
  const [history, setHistory] = useState<string[]>([]);
  const [at, setAt] = useState(-1);
  const [input, setInput] = useState("");
  const [reload, setReload] = useState(0);
  const [question, setQuestion] = useState("");
  const [agentId, setAgentId] = useState<string>("");
  const frame = useRef<HTMLIFrameElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const native = useMemo(() => nativePage(), []);
  // A native page draws above the window's HTML, so it steps aside while a sheet or ⌘K is open.
  const covered = useApp((s) => s.paletteOpen || s.compileOpen || s.hermesOpen || s.reportOpen || s.newAgentOpen || s.catalogOpen || s.chatAppsOpen || s.teamsOpen || s.shareOpen);
  const url = at >= 0 ? history[at]! : null;
  const box = (): PageBox | null => {
    const r = area.current?.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
  };

  // Desktop: show the typed address in the page; follow its size; hide it when leaving the view.
  useEffect(() => {
    if (!native || !url) return;
    const b = box();
    if (b && !covered) page.show(url, b).catch((err: unknown) => useApp.getState().toast({ kind: "fail", text: String(err) }));
    else void page.hide();
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
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
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
  const ask = async () => {
    const agent = agents.find((a) => a.id === (agentId || agents[0]?.id));
    if (!agent || !url || !question.trim()) return;
    const runId = await runAgent(boardId, agent.id, `${question.trim()}\n\nPage: ${url}\n(Open it with your browser tool.)`);
    if (runId) {
      setQuestion("");
      useApp.getState().toast({ kind: "ok", text: `Asked ${agent.data.displayName || agent.data.name}`, action: { label: "Open", run: () => useApp.getState().openChat(agent.id) } });
    }
  };

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
        <button className="icon-btn sm" aria-label="Open in a window" data-tip="Open in McBot's browser window" disabled={!url}
          onClick={() => url && void openBrowser(url).catch((err: unknown) => useApp.getState().toast({ kind: "fail", text: String(err) }))}><ExternalLink size={13} /></button>
      </div>
      <div className="browser-page">
        {url && native ? (
          <div ref={area} className="browser-native" data-testid="browser-native" />
        ) : url ? (
          <iframe key={`${url}#${reload}`} ref={frame} src={url} title="Page" sandbox="allow-scripts allow-forms allow-popups allow-same-origin allow-downloads" referrerPolicy="no-referrer" data-testid="browser-frame" />
        ) : (
          <Empty title="Browse next to your agents" action={
            <div className="row" style={{ flexWrap: "wrap", justifyContent: "center" }}>
              {START.map((s) => <button key={s} className="btn sm" onClick={() => go(s)}>{s}</button>)}
            </div>
          } />
        )}
        {url && !native && <div className="browser-hint faint">Blank page? This site blocks being shown inside apps. <button className="btn sm ghost" onClick={() => void openBrowser(url)}>Open in a window</button></div>}
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
