import { Command, MoreHorizontal, Pin, PinOff, Settings } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useApp, viewOf, type Tab } from "../state/store";
import { REMOTE } from "../lib/engine";
import { useDismiss } from "../lib/presence";
import { VIEWS } from "./Palette";

/** On another computer's boards: its files, folders, skill library and passwords stay there, so those views are hidden. */
export const HIDDEN_FOR_GUESTS = new Set(["code", "files", "skills", "passwords"]);

/** The views the rail shows; the rest sit behind "…" (pin them there). Kept per computer. */
const PINS_KEY = "mcbot.rail.pins";
export const DEFAULT_PINS: Tab[] = ["home", "graph", "agents", "tasks", "workflows", "knowledge"];
function loadPins(): Tab[] {
  try {
    const v = JSON.parse(localStorage.getItem(PINS_KEY) ?? "null") as unknown;
    // Pins from before Knowledge (Skills, Memory, Learn) become Knowledge.
    if (Array.isArray(v) && v.every((t) => typeof t === "string")) return [...new Set((v as Tab[]).map(viewOf))];
  } catch { /* storage unavailable: the default set */ }
  return DEFAULT_PINS;
}
function savePins(pins: Tab[]) {
  try { localStorage.setItem(PINS_KEY, JSON.stringify(pins)); } catch { /* not kept, still works */ }
}

export function Rail() {
  // Memory, Skills and Training are Knowledge's segments: the rail marks Knowledge for them.
  const tab = viewOf(useApp((s) => s.tab));
  const setTab = useApp((s) => s.setTab);
  const setPalette = useApp((s) => s.setPalette);
  const runs = useApp((s) => s.runs);
  const live = Object.values(runs).filter((r) => r.status === "running").length;
  const [pins, setPins] = useState<Tab[]>(loadPins);
  const [more, setMore] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const hide = useCallback(() => setMore(false), []);
  useDismiss(more, hide, menu);

  const all = VIEWS.filter((v) => !REMOTE || !HIDDEN_FOR_GUESTS.has(v.tab));
  // Pinned views, plus the one you are on even when it is not pinned (so you always see where you are).
  const shown = all.filter((v) => pins.includes(v.tab) || v.tab === tab);
  const togglePin = (t: Tab) => {
    const next = pins.includes(t) ? pins.filter((p) => p !== t) : [...pins, t];
    setPins(next);
    savePins(next);
  };

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
  }, [tab, pins]);
  useLayoutEffect(() => {
    if (y !== null && !ready) requestAnimationFrame(() => setReady(true));
  }, [y, ready]);

  const r = moreBtn.current?.getBoundingClientRect();
  return (
    <nav ref={nav} className={`rail${y !== null ? " has-indicator" : ""}`} aria-label="Views">
      {y !== null && <span className="rail-indicator" aria-hidden style={{ transform: `translateY(${y}px)`, transition: ready ? undefined : "none" }} />}
      {shown.map((v) => {
        const key = VIEWS.indexOf(v);
        const name = v.tip ? `${v.label} · ${v.tip}` : v.label;
        return (
          <button key={v.tab} className="rail-btn" aria-current={tab === v.tab ? "page" : undefined} onClick={() => setTab(v.tab)}
            data-tip={key < 9 ? `${name}  ⌘${key + 1}` : name} data-tip-side="right" data-testid={`tab-${v.tab}`} aria-label={v.label}>
            {v.icon}
            {v.tab === "agents" && live > 0 && <span className="badge">{live}</span>}
          </button>
        );
      })}
      <button ref={moreBtn} className="rail-btn" aria-label="More views" aria-haspopup="menu" aria-expanded={more} data-tip="More" data-tip-side="right"
        data-testid="rail-more" data-dismiss-ignore onClick={() => setMore((m) => !m)}>
        <MoreHorizontal size={16} />
      </button>
      {more && (
        <div ref={menu} className="menu rail-menu" role="menu" style={{ left: (r?.right ?? 60) + 8, top: Math.max(8, Math.min((r?.top ?? 200) - 40, window.innerHeight - 40 - all.length * 36)) }}>
          {all.map((v) => {
            const key = VIEWS.indexOf(v);
            const pinned = pins.includes(v.tab);
            return (
              <div key={v.tab} className="rail-menu-row">
                <button role="menuitem" className="grow" aria-current={tab === v.tab ? "page" : undefined} onClick={() => { setTab(v.tab); setMore(false); }}>
                  <span className="rail-menu-icon">{v.icon}</span>
                  <span className="grow">{v.label}</span>
                  {key < 9 && <span className="faint rail-menu-key">⌘{key + 1}</span>}
                </button>
                <button className="icon-btn sm rail-pin" aria-pressed={pinned} aria-label={pinned ? `Unpin ${v.label}` : `Pin ${v.label}`}
                  data-tip={pinned ? "Unpin from the side" : "Pin to the side"} onClick={() => togglePin(v.tab)}>
                  {pinned ? <PinOff size={13} /> : <Pin size={13} />}
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className="rail-foot">
        <button className="rail-btn" aria-current={tab === "settings" ? "page" : undefined} onClick={() => useApp.getState().openSettings()} data-tip="Settings  ⌘," data-tip-side="right" data-testid="tab-settings" aria-label="Settings"><Settings size={16} /></button>
        <button className="rail-btn" onClick={() => setPalette(true)} data-tip="Commands  ⌘K" data-tip-side="right" aria-label="Commands"><Command size={15} /></button>
      </div>
    </nav>
  );
}
