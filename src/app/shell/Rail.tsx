import { Command, Settings } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useApp } from "../state/store";
import { REMOTE } from "../lib/engine";
import { VIEWS } from "./Palette";

/** On another computer's boards: its files, folders and skill library stay there, so Code, Files and Skills are hidden. */
export const HIDDEN_FOR_GUESTS = new Set(["code", "files", "skills"]);

export function Rail() {
  const tab = useApp((s) => s.tab);
  const setTab = useApp((s) => s.setTab);
  const setPalette = useApp((s) => s.setPalette);
  const runs = useApp((s) => s.runs);
  const health = useApp((s) => s.health);
  const live = Object.values(runs).filter((r) => r.status === "running").length;
  // One selection tile that slides (spring) to the current view, as in iOS tab bars.
  const nav = useRef<HTMLElement>(null);
  const [y, setY] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const el = nav.current;
    if (!el) return;
    const place = () => {
      const on = el.querySelector<HTMLElement>('.rail-btn[aria-current="page"]');
      if (!on) return setY(null);
      const r = on.getBoundingClientRect();
      setY(r.top - el.getBoundingClientRect().top);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [tab]);
  useLayoutEffect(() => {
    if (y !== null && !ready) requestAnimationFrame(() => setReady(true));
  }, [y, ready]);

  return (
    <nav ref={nav} className={`rail${y !== null ? " has-indicator" : ""}`} aria-label="Views">
      {y !== null && <span className="rail-indicator" aria-hidden style={{ transform: `translateY(${y}px)`, transition: ready ? undefined : "none" }} />}
      {VIEWS.filter((v) => !REMOTE || !HIDDEN_FOR_GUESTS.has(v.tab)).map((v, i) => (
        <button key={v.tab} className="rail-btn" aria-current={tab === v.tab ? "page" : undefined} onClick={() => setTab(v.tab)}
          data-tip={i < 9 ? `${v.label}  ⌘${i + 1}` : v.label} data-tip-side="right" data-testid={`tab-${v.tab}`} aria-label={v.label}>
          {v.icon}
          {v.tab === "agents" && live > 0 && <span className="badge">{live}</span>}
        </button>
      ))}
      <div className="rail-foot">
        <button className="rail-btn" aria-current={tab === "settings" ? "page" : undefined} onClick={() => useApp.getState().openSettings()} data-tip="Settings  ⌘," data-tip-side="right" data-testid="tab-settings" aria-label="Settings"><Settings size={15} /></button>
        <button className="rail-btn" onClick={() => setPalette(true)} data-tip="Commands  ⌘K" data-tip-side="right" aria-label="Commands"><Command size={15} /></button>
        <button className="rail-btn" style={{ width: 38, height: 26 }} onClick={() => useApp.getState().openSettings("engine")} data-testid="hermes-dot"
          data-tip={health ? (health.hermes.found ? "Engine ready" : "Engine not set up") : "Engine offline"} data-tip-side="right" aria-label="Hermes">
          <span className={`dot ${health ? (health.hermes.found ? "ok" : "warn") : "fail"}`} />
        </button>
      </div>
    </nav>
  );
}
