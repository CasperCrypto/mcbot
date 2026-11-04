import { Bot } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { resolveGraph } from "../../compile";
import type { AgentMemoryView, CostReport } from "../../contracts/api";
import type { ModelData } from "../../contracts/graph";
import { ago, usd } from "../lib/format";
import { engine } from "../lib/engine";
import { useBoard } from "../state/board";
import { latestRunByAgent, useApp } from "../state/store";
import { Empty } from "../ui";

export function AgentsTab() {
  const { graph, boardId } = useBoard();
  const runs = useApp((s) => s.runs);
  const setTab = useApp((s) => s.setTab);
  const select = useApp((s) => s.select);
  const { bundles, issues } = useMemo(() => resolveGraph(graph), [graph]);
  const latest = useMemo(() => latestRunByAgent(runs), [runs]);
  const [memory, setMemory] = useState<AgentMemoryView[]>([]);
  const [cost, setCost] = useState<CostReport | null>(null);
  const runCount = Object.keys(runs).length;

  useEffect(() => {
    engine.memory(boardId).then(setMemory).catch(() => setMemory([]));
    engine.cost(boardId).then(setCost).catch(() => setCost(null));
  }, [boardId, runCount, latest]);

  if (!bundles.length) {
    return <div className="page"><Empty icon={<Bot size={28} />} title="No agents yet" action={<button className="btn primary" onClick={() => setTab("graph")}>Open the graph</button>}>Agents you draw on the graph show up here with their model, tools, memory, runs and cost.</Empty></div>;
  }

  return (
    <div className="page">
      <div className="card" style={{ overflow: "hidden" }}>
        <table className="table" data-testid="agents-table">
          <thead>
            <tr><th>Agent</th><th>Model</th><th>Tools</th><th>Skills</th><th>Memory</th><th>Last run</th><th>Status</th><th className="right">Cost</th></tr>
          </thead>
          <tbody>
            {bundles.map(({ agent, models, tools }) => {
              const run = latest.get(agent.id);
              const mem = memory.find((m) => m.nodeId === agent.id);
              const spend = cost?.byAgent.find((r) => r.key === agent.data.name);
              const errs = issues.filter((i) => i.nodeId === agent.id && i.level === "error").length;
              return (
                <tr key={agent.id} onClick={() => { select(agent.id); setTab("graph"); }} style={{ cursor: "default" }}>
                  <td>
                    <div className="row">
                      <div className="node-glyph agent"><Bot size={14} /></div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{agent.data.displayName || agent.data.name}</div>
                        <div className="faint mono" style={{ fontSize: 11 }}>hermes -p {agent.data.name}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="mono" style={{ fontSize: 12 }}>{models[0] ? (models[0].data as ModelData).model : <span className="badge fail">none</span>}</div>
                    {models.length > 1 && <div className="faint" style={{ fontSize: 11 }}>+{models.length - 1} fallback</div>}
                  </td>
                  <td className="num">{tools.length ? tools.map((t) => t.data.name).join(", ") : <span className="faint">—</span>}</td>
                  <td className="num">{agent.data.skills.length || <span className="faint">—</span>}</td>
                  <td className="num">
                    {mem?.memory.exists || mem?.user.exists ? (
                      <span>{mem.memory.entries.length + mem.user.entries.length} entries <span className="faint">· {mem.memory.chars + mem.user.chars} chars</span></span>
                    ) : <span className="faint">empty</span>}
                  </td>
                  <td>{run ? <span title={run.prompt}>{ago(run.startedAt)}</span> : <span className="faint">never</span>}</td>
                  <td>
                    {errs ? <span className="badge fail">{errs} error{errs > 1 ? "s" : ""}</span>
                      : run ? <span className={`badge ${run.status === "succeeded" ? "ok" : run.status === "running" ? "run" : "fail"}`}>{run.status}</span>
                      : mem?.compiled ? <span className="badge">compiled</span> : <span className="badge warn">not compiled</span>}
                  </td>
                  <td className="right num">{spend ? <>{usd(spend.usd)}{spend.source === "estimate" && <span className="faint"> est.</span>}</> : <span className="faint">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
