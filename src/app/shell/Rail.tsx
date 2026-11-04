import { Command } from "lucide-react";
import { useApp } from "../state/store";
import { VIEWS } from "./Palette";

export function Rail() {
  const tab = useApp((s) => s.tab);
  const setTab = useApp((s) => s.setTab);
  const setPalette = useApp((s) => s.setPalette);
  const runs = useApp((s) => s.runs);
  const health = useApp((s) => s.health);
  const live = Object.values(runs).filter((r) => r.status === "running").length;

  return (
    <nav className="rail" aria-label="Views">
      {VIEWS.map((v, i) => (
        <button key={v.tab} className="rail-btn" aria-current={tab === v.tab ? "page" : undefined} onClick={() => setTab(v.tab)}
          data-tip={`${v.label}  ⌘${i + 1}`} data-tip-side="right" data-testid={`tab-${v.tab}`} aria-label={v.label}>
          {v.icon}
          {v.tab === "agents" && live > 0 && <span className="badge">{live}</span>}
        </button>
      ))}
      <div className="rail-foot">
        <button className="rail-btn" onClick={() => setPalette(true)} data-tip="Commands  ⌘K" data-tip-side="right" aria-label="Commands"><Command size={15} /></button>
        <button className="rail-btn" style={{ width: 38, height: 26 }} onClick={() => useApp.getState().setHermesOpen(true)} data-testid="hermes-dot"
          data-tip={health ? (health.hermes.found ? (health.hermes.kind === "bundled" ? "Hermes (built in)" : "Hermes") : "Hermes not set up: npm run hermes:setup") : "Engine offline"} data-tip-side="right" aria-label="Hermes">
          <span className={`dot ${health ? (health.hermes.found ? "ok" : "warn") : "fail"}`} />
        </button>
      </div>
    </nav>
  );
}
