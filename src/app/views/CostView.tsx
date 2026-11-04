import { useEffect, useState } from "react";
import type { CostReport, CostRow, CostSource } from "../../contracts/api";
import { ago, tokens, usd } from "../lib/format";
import { engine } from "../lib/engine";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { AgentFace, Empty } from "../ui";

const SOURCE: Record<CostSource, { label: string; cls: string; tip: string }> = {
  hermes: { label: "Hermes", cls: "ok", tip: "Priced by Hermes" },
  estimate: { label: "est.", cls: "warn", tip: "Estimated from the model node's price" },
  none: { label: "—", cls: "", tip: "No price for this endpoint" },
};
const Source = ({ s }: { s: CostSource }) => <span className={`chip ${SOURCE[s].cls}`} data-tip={SOURCE[s].tip} data-tip-side="top">{SOURCE[s].label}</span>;

/** One series (spend per day): no legend, the peak is the only direct label. */
function Daily({ rows }: { rows: CostRow[] }) {
  const days = [...rows].sort((a, b) => (a.key < b.key ? -1 : 1)).slice(-21);
  const byTokens = days.every((d) => d.usd === 0);
  const value = (r: CostRow) => (byTokens ? r.inputTokens + r.outputTokens : r.usd);
  const max = Math.max(...days.map(value), 0);
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div className="card chart-card">
      <h3>{byTokens ? "Tokens per day" : "Spend per day"}</h3>
      <span className="faint" style={{ fontSize: 12 }}>UTC</span>
      <div className="bars" role="img" aria-label={days.map((d) => `${d.key}: ${byTokens ? tokens(value(d)) : usd(d.usd)}`).join(", ")}>
        {days.map((d) => (
          <div key={d.key} className="bar" onMouseEnter={() => setHover(d.key)} onMouseLeave={() => setHover(null)}>
            {value(d) === max && max > 0 && <span className="peak num">{byTokens ? tokens(max) : usd(max)}</span>}
            <i style={{ height: `${max ? Math.max(2, (value(d) / max) * 86) : 2}%`, opacity: hover && hover !== d.key ? 0.45 : 1 }} />
            {hover === d.key && (
              <div className="tip">
                <b>{d.key}</b>
                <div className="num">{usd(d.usd)} · {d.sessions} session{d.sessions === 1 ? "" : "s"}</div>
                <div className="faint num">{tokens(d.inputTokens)} in · {tokens(d.outputTokens)} out</div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
        <span className="faint" style={{ fontSize: 11 }}>{days[0]?.key}</span>
        {days.length > 1 && <span className="faint" style={{ fontSize: 11 }}>{days.at(-1)?.key}</span>}
      </div>
    </div>
  );
}

function Rollup({ title, rows, face }: { title: string; rows: CostRow[]; face?: boolean }) {
  return (
    <div className="card table-card">
      <h3>{title}</h3>
      <table className="table">
        <thead><tr><th>{title.replace("By a", "A").replace("By m", "M")}</th><th className="right">Sessions</th><th className="right">In</th><th className="right">Out</th><th className="right">Spend</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td><span className="row">{face && <AgentFace seed={r.key} size={22} />}<span className={face ? "" : "mono"}>{r.label}</span></span></td>
              <td className="right num">{r.sessions}</td>
              <td className="right num">{tokens(r.inputTokens)}</td>
              <td className="right num">{tokens(r.outputTokens)}</td>
              <td className="right num"><span className="row" style={{ justifyContent: "flex-end" }}>{usd(r.usd)}<Source s={r.source} /></span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CostView() {
  const { boardId } = useBoard();
  const runs = useApp((s) => s.runs);
  const [report, setReport] = useState<CostReport | null>(null);
  const finished = Object.values(runs).filter((r) => r.status !== "running").length;
  useEffect(() => {
    engine.cost(boardId).then(setReport).catch(() => setReport(null));
  }, [boardId, finished]);

  return (
    <section className="main flush-left">
      {!report ? null : !report.sessions.length ? (
        <Empty title="No spend yet">Spend appears after an agent runs.</Empty>
      ) : (
        <div className="scroll-page page-enter">
          <div className="kpis" data-testid="cost-kpis">
            <div className="card kpi"><small>Spend</small><b>{usd(report.totals.usd)}</b><span>{report.totals.sessions} sessions</span></div>
            <div className="card kpi"><small>Tokens</small><b>{tokens(report.totals.inputTokens + report.totals.outputTokens)}</b><span>{tokens(report.totals.inputTokens)} in · {tokens(report.totals.outputTokens)} out</span></div>
            <div className="card kpi"><small>Per successful run</small><b>{report.costPerSuccessfulRun === null ? "—" : usd(report.costPerSuccessfulRun)}</b><span>{report.totals.successfulRuns} of {report.totals.runs} succeeded</span></div>
            <div className="card kpi"><small>Local compute</small><b>{report.localInferenceSeconds.toFixed(1)}s</b><span data-tip="Wall-clock time of runs on local models. Hermes does not report GPU time." data-tip-side="top">wall-clock</span></div>
          </div>
          <Daily rows={report.byDay} />
          <div className="two-col">
            <Rollup title="By agent" rows={report.byAgent} face />
            <Rollup title="By model" rows={report.byModel} />
          </div>
          <div className="card table-card" style={{ marginTop: 14 }}>
            <h3>Sessions</h3>
            <table className="table" data-testid="cost-sessions">
              <thead><tr><th>When</th><th>Agent</th><th>Model</th><th className="right">In</th><th className="right">Out</th><th>Run</th><th className="right">Spend</th></tr></thead>
              <tbody>
                {report.sessions.slice(0, 200).map((s) => (
                  <tr key={`${s.profile}/${s.id}`}>
                    <td className="faint">{ago(s.startedAt * 1000)}</td>
                    <td><span className="row"><AgentFace seed={s.profile} size={20} />{s.profile}</span></td>
                    <td className="mono">{s.model ?? "—"}</td>
                    <td className="right num">{tokens(s.inputTokens)}</td>
                    <td className="right num">{tokens(s.outputTokens)}</td>
                    <td>{s.runStatus ? <span className={`chip ${s.runStatus === "succeeded" ? "ok" : "fail"}`}>{s.runStatus}</span> : <span className="faint" data-tip="Started outside McBot (cron, chat, gateway)" data-tip-side="top">external</span>}</td>
                    <td className="right num"><span className="row" style={{ justifyContent: "flex-end" }}>{usd(s.usd)}<Source s={s.source} /></span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
