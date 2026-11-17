/**
 * The floating island's own window (label `island`, src-tauri). It shows the summary the main
 * window sends, grows to fit it, and sends back what the person picks. Click opens McBot.
 */
import { ChevronUp, ShieldAlert } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ISLAND_ACT, ISLAND_READY, ISLAND_STATE, type IslandAct, type IslandState } from "../lib/islandBridge";
import { AgentFace } from "../ui";

async function send(act: IslandAct) {
  const { emitTo } = await import("@tauri-apps/api/event");
  await emitTo("main", ISLAND_ACT, act);
}

export function IslandPill() {
  const [s, setS] = useState<IslandState>({ mode: "rest", text: "McBot", count: 0 });
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let off: (() => void) | undefined;
    let live = true;
    void (async () => {
      const { listen, emitTo } = await import("@tauri-apps/api/event");
      const f = await listen<IslandState>(ISLAND_STATE, (e) => setS(e.payload));
      if (live) off = f; else f();
      await emitTo("main", ISLAND_READY, null);
    })();
    return () => { live = false; off?.(); };
  }, []);

  // The window is as big as the pill: the shell resizes and re-centres it.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("island_resize", { width: Math.ceil(el.offsetWidth), height: Math.ceil(el.offsetHeight) }).catch(() => undefined);
    };
    void fit();
    const ro = new ResizeObserver(() => void fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [s.mode]);

  const open = () => void send({ type: "open" });
  return (
    <div ref={box} className={`pill-island ${s.mode}`} data-testid="island-pill">
      <div className="pill-row" role="button" tabIndex={0} onClick={open} onKeyDown={(e) => { if (e.key === "Enter") open(); }}>
        {s.mode === "rest" ? <span className="pill-dot" /> : <AgentFace seed={s.seed} size={22} status="running" />}
        {s.mode === "ask" && <ShieldAlert size={13} className="warn-text" />}
        <b className="ellipsis">{s.text}</b>
        {s.count > 0 && s.mode !== "rest" && <span className="pill-count">{s.count}</span>}
        <button className="icon-btn sm" aria-label="Hide McBot" onClick={(e) => { e.stopPropagation(); void send({ type: "hide" }); }}><ChevronUp size={12} /></button>
      </div>
      {s.mode === "ask" && (
        <div className="pill-ask">
          <code className="ellipsis">{s.sub}</code>
          <button className="pill primary" onClick={() => void send({ type: "answer", runId: s.runId, choice: "once" })}>Allow once</button>
          <button className="pill danger" onClick={() => void send({ type: "answer", runId: s.runId, choice: "deny" })}>Deny</button>
        </div>
      )}
    </div>
  );
}
