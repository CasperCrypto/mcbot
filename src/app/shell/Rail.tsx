import { Command, Settings } from "lucide-react";
import { useApp } from "../state/store";
import { REMOTE } from "../lib/engine";
import { VIEWS } from "./Palette";

/** On another computer's boards: its files and folders stay there, so Code and Files are hidden. */
export const HIDDEN_FOR_GUESTS = new Set(["code", "files"]);

export function Rail() {
  const tab = useApp((s) => s.tab);
  const setTab = useApp((s) => s.setTab);
  const setPalette = useApp((s) => s.setPalette);
  const runs = useApp((s) => s.runs);
  const health = useApp((s) => s.health);
  const live = Object.values(runs).filter((r) => r.status === "running").length;

  return (
    <nav className="rail" aria-label="Views">
      {VIEWS.filter((v) => !REMOTE || !HIDDEN_FOR_GUESTS.has(v.tab)).map((v, i) => (
        <button key={v.tab} className="rail-btn" aria-current={tab === v.tab ? "page" : undefined} onClick={() => setTab(v.tab)}
          data-tip={`${v.label}  ⌘${i + 1}`} data-tip-side="right" data-testid={`tab-${v.tab}`} aria-label={v.label}>
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
