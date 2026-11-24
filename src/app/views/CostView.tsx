import { useEffect, useState } from "react";
import { ModelMark } from "../graph/Logo";
import { modelName } from "../lib/modelName";
import type { BudgetStatus, CostReport, CostRow, CostSource } from "../../contracts/api";
import { ago, tokens, usd } from "../lib/format";
import { dailySeries, dayLabel } from "../lib/series";
import { engine } from "../lib/engine";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { AgentFace, Empty } from "../ui";
import type { Graph } from "../../contracts/graph";

const SOURCE: Record<CostSource, { label: string; cls: string; tip: string }> = {
  hermes: { label: "reported", cls: "ok", tip: "Priced by the provider" },
  estimate: { label: "est.", cls: "warn", tip: "Estimated from the model node's price" },
  none: { label: "—", cls: "", tip: "No price for this endpoint" },
};
const Source = ({ s }: { s: CostSource }) => <span className={`chip ${SOURCE[s].cls}`} data-tip={SOURCE[s].tip} data-tip-side="top">{SOURCE[s].label}</span>;

/** One series (spend per day): a continuous run of days, no legend, the peak is the only direct label. */
function Daily({ rows }: { rows: CostRow[] }) {
  const now = Date.now();
  const days = dailySeries(rows, now);
  const byTokens = days.every((d) => d.usd === 0);
  const value = (r: CostRow) => (byTokens ? r.inputTokens + r.outputTokens : r.usd);
  const max = Math.max(...days.map(value), 0);
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div className="card chart-card">
      <div className="chart-head">
        <h3>{byTokens ? "Tokens per day" : "Spend per day"}</h3>
        <span className="faint">Last {days.length} days · UTC</span>
      </div>
      <div className="bars" role="img" aria-label={days.filter((d) => value(d) > 0).map((d) => `${d.key}: ${byTokens ? tokens(value(d)) : usd(d.usd)}`).join(", ") || "Nothing spent"}>
        {days.map((d) => (
          <div key={d.key} className={`bar${value(d) === 0 ? " zero" : ""}`} onMouseEnter={() => setHover(d.key)} onMouseLeave={() => setHover(null)}>
            {value(d) === max && max > 0 && <span className="peak num">{byTokens ? tokens(max) : usd(max)}</span>}
            <i style={{ height: value(d) > 0 && max ? `${Math.max(3, (value(d) / max) * 86)}%` : undefined, opacity: hover && hover !== d.key ? 0.45 : 1 }} />
            {hover === d.key && (
              <div className="tip">
                <b>{dayLabel(d.key, now)}</b>
                <div className="num">{usd(d.usd)} · {d.sessions} session{d.sessions === 1 ? "" : "s"}</div>
                <div className="faint num">{tokens(d.inputTokens)} in · {tokens(d.outputTokens)} out</div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="row chart-axis">
        <span>{dayLabel(days[0]!.key, now)}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

/** Spend today against each agent's daily budget. */
function Budgets({ rows, name }: { rows: BudgetStatus[]; name: (profile: string) => string }) {
  return (
    <div className="card table-card" style={{ marginBottom: 14 }} data-testid="cost-budgets">
      <h3>Budgets today</h3>
      <table className="table">
        <tbody>
          {rows.map((b) => (
            <tr key={b.profile}>
              <td><span className="row"><AgentFace seed={b.profile} size={22} />{name(b.profile)}</span></td>
              <td style={{ width: "40%" }}>
                <div role="progressbar" aria-valuemin={0} aria-valuemax={b.limitUsd} aria-valuenow={Math.min(b.spentTodayUsd, b.limitUsd)} style={{ height: 6, borderRadius: 3, background: "rgb(var(--tint-rgb) / 0.08)" }}>
                  <i style={{ display: "block", height: "100%", borderRadius: 3, width: `${Math.min(100, (b.spentTodayUsd / b.limitUsd) * 100)}%`, background: b.state === "over" ? "var(--fail)" : b.state === "warn" ? "var(--warn)" : "var(--ok)" }} />
                </div>
              </td>
              <td className="right num">{usd(b.spentTodayUsd)} / {usd(b.limitUsd)}</td>
              <td className="right"><span className={`chip ${b.state === "over" ? "fail" : b.state === "warn" ? "warn" : "ok"}`}>{b.state === "over" ? "over" : b.state === "warn" ? "close" : "ok"}</span>{b.unpriced && <span className="chip" data-tip="Some sessions today have no price, so the real spend may be higher" data-tip-side="top">unpriced</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The agent's name on the board for a Hermes profile; the profile itself when the board has no such agent. */
const agentName = (graph: Graph, profile: string) => {
  const a = graph.nodes.find((n) => n.kind === "agent" && n.data.name === profile);
  return a?.kind === "agent" ? a.data.displayName || a.data.name : profile;
};

function Rollup({ title, rows, face, name, model }: { title: string; rows: CostRow[]; face?: boolean; name?: (key: string) => string; model?: boolean }) {
  return (
    <div className="card table-card">
      <h3>{title}</h3>
      <table className="table">
        <thead><tr><th>{title.replace("By a", "A").replace("By m", "M")}</th><th className="right">Sessions</th><th className="right">In</th><th className="right">Out</th><th className="right">Spend</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{model
                ? <span className="row" data-tip={r.label}><ModelMark model={r.label} size={18} /><span>{modelName(r.label)}</span></span>
                : <span className="row">{face && <AgentFace seed={r.key} size={22} />}<span className={face ? "" : "mono"}>{name ? name(r.key) : r.label}</span></span>}</td>
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
  const { boardId, graph } = useBoard();
  const runs = useApp((s) => s.runs);
  const [report, setReport] = useState<CostReport | null>(null);
  const finished = Object.values(runs).filter((r) => r.status !== "running").length;
  useEffect(() => {
    engine.cost(boardId).then(setReport).catch(() => setReport(null));
  }, [boardId, finished]);

  const nameOf = (profile: string) => agentName(graph, profile);

  return (
    <section className="main flush-left">
      <div className="view">
        <div className="view-head">
          <h1>Cost</h1>
          {report && report.sessions.length > 0 && <span className="faint num" style={{ fontSize: 13 }}>{usd(report.totals.usd)} · {report.totals.sessions} session{report.totals.sessions === 1 ? "" : "s"}</span>}
        </div>
        <div style={{ position: "absolute", inset: "52px 0 0 0" }}>
      {!report ? null : !report.sessions.length ? (
        <Empty title="No spend yet" action={<button className="btn light" onClick={() => useApp.getState().setTab("agents")}>Message an agent</button>}>Spend shows here after an agent runs.</Empty>
      ) : (
        <div className="scroll-page page-enter">
          <div className="kpis" data-testid="cost-kpis">
            {(() => {
              const localOnly = report.sessions.every((x) => x.local);
              const local = report.sessions.filter((x) => x.local).length;
              return <div className="card kpi"><small>Spend</small><b>{localOnly ? "Free" : usd(report.totals.usd)}</b><span>{localOnly ? "on your computer" : local ? `${local} of ${report.totals.sessions} sessions free (local)` : `${report.totals.sessions} session${report.totals.sessions === 1 ? "" : "s"}`}</span></div>;
            })()}
            <div className="card kpi"><small>Tokens</small><b>{tokens(report.totals.inputTokens + report.totals.outputTokens)}</b><span>{tokens(report.totals.inputTokens)} in · {tokens(report.totals.outputTokens)} out</span></div>
            <div className="card kpi"><small>Per successful run</small><b>{report.costPerSuccessfulRun === null ? "—" : usd(report.costPerSuccessfulRun)}</b><span>{report.totals.successfulRuns} of {report.totals.runs} succeeded</span></div>
            <div className="card kpi"><small>Local compute</small><b>{report.localInferenceSeconds.toFixed(1)}s</b><span data-tip="Wall-clock time of runs on local models. GPU time is not reported." data-tip-side="top">wall-clock</span></div>
          </div>
          {(() => {
            // A cloud endpoint with no provider price: say so once, and open its price fields. A local
            // model is free, not unpriced.
            const unpriced = report.sessions.filter((x) => x.source === "none" && !x.local);
            const model = graph.nodes.find((n) => n.kind === "model" && n.data.endpoint === "cloud" && !n.data.pricing);
            if (!unpriced.length || !model) return null;
            const t = unpriced.reduce((n, x) => n + x.inputTokens + x.outputTokens, 0);
            return (
              <div className="card notice-row" data-testid="cost-unpriced">
                <span className="grow">{tokens(t)} tokens have no price, so they count as $0.</span>
                <button className="btn sm" onClick={() => { useApp.getState().setTab("graph"); useApp.getState().select(model.id); }}>Set a price</button>
              </div>
            );
          })()}
          {report.budgets.length > 0 && <Budgets rows={report.budgets} name={nameOf} />}
          <Daily rows={report.byDay} />
          <div className="two-col">
            <Rollup title="By agent" rows={report.byAgent} face name={nameOf} />
            <Rollup title="By model" rows={report.byModel} model />
          </div>
          <div className="card table-card" style={{ marginTop: 14 }}>
            <h3>Sessions</h3>
            <table className="table" data-testid="cost-sessions">
              <thead><tr><th>When</th><th>Agent</th><th>Model</th><th className="right">In</th><th className="right">Out</th><th>Run</th><th className="right">Spend</th></tr></thead>
              <tbody>
                {report.sessions.slice(0, 200).map((s) => (
                  <tr key={`${s.profile}/${s.id}`}>
                    <td className="faint">{ago(s.startedAt * 1000)}</td>
                    <td><span className="row"><AgentFace seed={s.profile} size={20} />{nameOf(s.profile)}</span></td>
                    <td>{s.model ? <span className="row" data-tip={s.model}><ModelMark model={s.model} size={16} /><span>{modelName(s.model)}</span></span> : "—"}</td>
                    <td className="right num">{tokens(s.inputTokens)}</td>
                    <td className="right num">{tokens(s.outputTokens)}</td>
                    <td>{s.runStatus ? <span className={`chip ${s.runStatus === "succeeded" ? "ok" : "fail"}`}>{s.runStatus}</span> : <span className="faint" data-tip="Started outside McBot (cron, chat, gateway)" data-tip-side="top">external</span>}</td>
                    <td className="right num"><span className="row" style={{ justifyContent: "flex-end" }}>{s.local ? <span className="faint">Free</span> : <>{usd(s.usd)}<Source s={s.source} /></>}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
        </div>
      </div>
    </section>
  );
}
