import { Coins } from "lucide-react";
import { useEffect, useState } from "react";
import type { CostReport, CostRow, CostSource } from "../../contracts/api";
import { ago, tokens, usd } from "../lib/format";
import { engine } from "../lib/engine";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { Empty } from "../ui";

const SOURCE: Record<CostSource, { label: string; cls: string; title: string }> = {
  hermes: { label: "Hermes", cls: "ok", title: "Priced by Hermes (sessions.estimated_cost_usd)" },
  estimate: { label: "estimate", cls: "warn", title: "Hermes has no price for this endpoint; estimated from the model node's pricing" },
  none: { label: "unpriced", cls: "", title: "Hermes has no price and the model node has no pricing" },
};
const Source = ({ s }: { s: CostSource }) => <span className={`badge ${SOURCE[s].cls}`} title={SOURCE[s].title}>{SOURCE[s].label}</span>;

/** Spend per day: one series, so no legend; the peak is the only direct label. */
function DailySpend({ rows }: { rows: CostRow[] }) {
  const days = [...rows].sort((a, b) => (a.key < b.key ? -1 : 1)).slice(-14);
  const byTokens = days.every((d) => d.usd === 0);
  const value = (r: CostRow) => (byTokens ? r.inputTokens + r.outputTokens : r.usd);
  const max = Math.max(...days.map(value), 0);
  const peak = days.find((d) => value(d) === max);
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div className="card">
      <div className="card-head"><h3>{byTokens ? "Tokens per day" : "Spend per day"}</h3><span className="faint">UTC · last {days.length} day{days.length === 1 ? "" : "s"}</span></div>
      <div className="card-body" style={{ position: "relative" }}>
        <div className="bars" role="img" aria-label={days.map((d) => `${d.key}: ${byTokens ? tokens(value(d)) : usd(d.usd)}`).join(", ")} style={{ borderBottom: "1px solid var(--hairline-2)" }}>
          {days.map((d) => (
            <div key={d.key} className="bar" onMouseEnter={() => setHover(d.key)} onMouseLeave={() => setHover(null)} style={{ position: "relative" }}>
              {d === peak && max > 0 && <small className="num" style={{ color: "var(--text-2)" }}>{byTokens ? tokens(max) : usd(max)}</small>}
              <i style={{ height: `${max ? Math.max(2, (value(d) / max) * 100) : 2}%`, maxWidth: 24, borderRadius: "4px 4px 0 0", opacity: hover && hover !== d.key ? 0.55 : 1 }} />
              {hover === d.key && (
                <div className="menu" style={{ bottom: "100%", left: "50%", transform: "translateX(-50%)", minWidth: 150, padding: "8px 10px", pointerEvents: "none" }}>
                  <div style={{ fontWeight: 600 }}>{d.key}</div>
                  <div className="num">{usd(d.usd)} <Source s={d.source} /></div>
                  <div className="faint num" style={{ fontSize: 11 }}>{d.sessions} session{d.sessions === 1 ? "" : "s"} · {tokens(d.inputTokens)} in · {tokens(d.outputTokens)} out</div>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
          <span className="faint" style={{ fontSize: 11 }}>{days[0]?.key}</span>
          {days.length > 1 && <span className="faint" style={{ fontSize: 11 }}>{days.at(-1)?.key}</span>}
        </div>
      </div>
    </div>
  );
}

function RollupTable({ title, rows, labelHead }: { title: string; rows: CostRow[]; labelHead: string }) {
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div className="card-head"><h3>{title}</h3></div>
      <table className="table">
        <thead><tr><th>{labelHead}</th><th className="right">Sessions</th><th className="right">Tokens in</th><th className="right">Tokens out</th><th className="right">Spend</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="mono" style={{ fontSize: 12 }}>{r.label}</td>
              <td className="right num">{r.sessions}</td>
              <td className="right num">{tokens(r.inputTokens)}</td>
              <td className="right num">{tokens(r.outputTokens)}</td>
              <td className="right num">{usd(r.usd)} <Source s={r.source} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CostTab() {
  const { boardId } = useBoard();
  const runs = useApp((s) => s.runs);
  const [report, setReport] = useState<CostReport | null>(null);
  const finished = Object.values(runs).filter((r) => r.status !== "running").length;

  useEffect(() => {
    engine.cost(boardId).then(setReport).catch(() => setReport(null));
  }, [boardId, finished]);

  if (!report) return <div className="page" />;
  if (!report.sessions.length) {
    return <div className="page"><Empty icon={<Coins size={28} />} title="No spend yet">Cost comes from each compiled profile's own Hermes session records (state.db). Run an agent and it appears here.</Empty></div>;
  }
  const t = report.totals;
  const anyEstimate = report.sessions.some((s) => s.source === "estimate");

  return (
    <div className="page">
      <div className="kpis" data-testid="cost-kpis">
        <div className="card kpi"><small>Total spend</small><b>{usd(t.usd)}</b><span>{t.sessions} session{t.sessions === 1 ? "" : "s"}{anyEstimate ? " · includes estimates" : ""}</span></div>
        <div className="card kpi"><small>Tokens</small><b>{tokens(t.inputTokens + t.outputTokens)}</b><span>{tokens(t.inputTokens)} in · {tokens(t.outputTokens)} out</span></div>
        <div className="card kpi"><small>Cost per successful run</small><b>{report.costPerSuccessfulRun === null ? "—" : usd(report.costPerSuccessfulRun)}</b><span>{t.successfulRuns} of {t.runs} McBot run{t.runs === 1 ? "" : "s"} succeeded</span></div>
        <div className="card kpi"><small>Local inference time</small><b>{report.localInferenceSeconds.toFixed(1)} s</b><span title="Hermes does not report GPU-seconds; this is wall-clock time of runs on local endpoints">wall-clock, local endpoints</span></div>
      </div>
      <DailySpend rows={report.byDay} />
      <div className="two-col">
        <RollupTable title="By agent" labelHead="Agent" rows={report.byAgent} />
        <RollupTable title="By model" labelHead="Model" rows={report.byModel} />
      </div>
      <div className="card" style={{ marginTop: 16, overflow: "hidden" }}>
        <div className="card-head"><h3>Sessions</h3><span className="faint">from profiles/&lt;agent&gt;/state.db</span></div>
        <table className="table" data-testid="cost-sessions">
          <thead><tr><th>When</th><th>Agent</th><th>Model</th><th className="right">In</th><th className="right">Out</th><th>Run</th><th className="right">Spend</th></tr></thead>
          <tbody>
            {report.sessions.slice(0, 200).map((s) => (
              <tr key={`${s.profile}/${s.id}`}>
                <td>{ago(s.startedAt * 1000)}</td>
                <td>{s.profile}</td>
                <td className="mono" style={{ fontSize: 12 }}>{s.model ?? "—"}</td>
                <td className="right num">{tokens(s.inputTokens)}</td>
                <td className="right num">{tokens(s.outputTokens)}</td>
                <td>{s.runStatus ? <span className={`badge ${s.runStatus === "succeeded" ? "ok" : "fail"}`}>{s.runStatus}</span> : <span className="faint" title="Not launched from McBot (cron, chat, gateway)">outside McBot</span>}</td>
                <td className="right num">{usd(s.usd)} <Source s={s.source} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
