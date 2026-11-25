/**
 * Learn: your agents' work as data to train your own model (src/harness/learn.ts, engine/learn.ts).
 * Each agent shows its conversations, thumbs up and down, the mean reward and how many are good
 * enough to train on; its checks grade every answer; Export writes a dataset (chat, with rewards,
 * or Hermes' trajectory format). Then where to train on it, and how to use the model you made.
 */
import { Download, ExternalLink, Plus, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useEffect, useState } from "react";
import { setNodeField } from "../../board/ydoc";
import type { LearnAgentView, LearnView as LearnData } from "../../contracts/api";
import type { AgentNode, Check } from "../../contracts/graph";
import { CHECK_KINDS, CHECK_LABELS, type DatasetFormat, type DatasetPick } from "../../harness/learn";
import { newId } from "../graph/defaults";
import { engine, REMOTE } from "../lib/engine";
import { canReveal, openExternal, revealFile } from "../lib/open";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { AgentFace, Segmented, SkeletonCards } from "../ui";
import { Picker } from "../Picker";

const FORMATS: { value: DatasetFormat; label: string; tip: string }[] = [
  { value: "chat", label: "Chat", tip: "OpenAI chat format: OpenAI and Together fine-tuning, Unsloth, Hugging Face TRL, MLX" },
  { value: "rewards", label: "With rewards", tip: "Each conversation with its reward from 0 to 1, for preference or RL training" },
  { value: "sharegpt", label: "Hermes", tip: "Hermes' own trajectory format (ShareGPT), for Nous' trajectory and RL tools" },
];

const TRAIN = [
  { label: "On a Mac", sub: "MLX: LoRA on Apple silicon", url: "https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/LORA.md" },
  { label: "Free GPU", sub: "Unsloth notebooks", url: "https://docs.unsloth.ai/get-started/fine-tuning-llms-guide" },
  { label: "Hosted", sub: "OpenAI fine-tuning", url: "https://platform.openai.com/docs/guides/supervised-fine-tuning" },
  { label: "The whole guide", sub: "From your data to your model in McBot", url: "https://github.com/CasperCrypto/mcbot/blob/main/docs/TRAINING.md" },
];

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

function Checks({ agent }: { agent: AgentNode }) {
  const { doc } = useBoard();
  const checks = agent.data.checks ?? [];
  const write = (next: Check[]) => setNodeField(doc, agent.id, "checks", next.length ? next : undefined);
  return (
    <div className="learn-checks" data-testid="learn-checks">
      {checks.map((c, i) => (
        <div key={c.id} className="learn-check">
          <Picker sm label="Check" value={c.kind} onChange={(v) => write(checks.map((x, j) => (j === i ? { ...x, kind: v } : x)))}
            options={CHECK_KINDS.map((k) => ({ value: k, label: CHECK_LABELS[k].label }))} />
          {c.kind !== "json" && (
            <input value={c.value} placeholder={CHECK_LABELS[c.kind].placeholder} aria-label="Value" maxLength={400}
              onChange={(e) => write(checks.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
          )}
          <button className="icon-btn sm" aria-label="Remove check" onClick={() => write(checks.filter((_, j) => j !== i))}><X size={13} /></button>
        </div>
      ))}
      <button className="btn sm ghost" onClick={() => write([...checks, { id: newId("check"), kind: "includes", value: "" }])} data-testid="learn-add-check"><Plus size={13} /> Add a check</button>
    </div>
  );
}

function AgentRow({ stats, agent, folder }: { stats: LearnAgentView; agent: AgentNode | undefined; folder: string }) {
  const { boardId } = useBoard();
  const [open, setOpen] = useState<"checks" | "export" | null>(null);
  const [format, setFormat] = useState<DatasetFormat>("chat");
  const [pick, setPick] = useState<DatasetPick>("good");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const app = useApp.getState();
    try {
      const res = await engine.exportDataset(boardId, stats.agentNodeId, format, pick);
      if (!res.examples) app.toast({ kind: "info", text: pick === "good" ? "Nothing good enough yet: rate some answers, or add checks" : "No finished conversations yet" });
      else if (res.text !== undefined) {
        const url = URL.createObjectURL(new Blob([`${res.text}\n`], { type: "application/jsonl" }));
        Object.assign(document.createElement("a"), { href: url, download: res.file }).click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        app.toast({ kind: "ok", text: `${res.examples} conversation${res.examples === 1 ? "" : "s"} in ${res.file}` });
      } else app.toast({ kind: "ok", text: `${res.examples} conversation${res.examples === 1 ? "" : "s"} in ${res.shown}`, action: canReveal() ? { label: "Show", run: () => void revealFile(res.path) } : undefined });
    } catch (err) {
      app.toast({ kind: "fail", text: (err as Error).message });
    }
    setBusy(false);
  };
  return (
    <section className="learn-agent" data-testid={`learn-agent-${stats.profile}`}>
      <div className="learn-agent-head">
        <AgentFace seed={stats.profile} size={34} />
        <div className="grow learn-agent-text">
          <b>{stats.name}</b>
          <span className="learn-stats num">
            <span>{stats.conversations} conversation{stats.conversations === 1 ? "" : "s"}</span>
            <span data-tip="Good answers"><ThumbsUp size={12} /> {stats.up}</span>
            <span data-tip="Not good"><ThumbsDown size={12} /> {stats.down}</span>
            <span data-tip="Mean reward: thumbs, else checks">{pct(stats.reward)}</span>
          </span>
        </div>
        <span className="learn-ready" data-tip="Conversations good enough to train on"><b className="num">{stats.good}</b> ready</span>
        {agent && <button className="btn sm" aria-expanded={open === "checks"} onClick={() => setOpen(open === "checks" ? null : "checks")} data-testid={`learn-checks-${stats.profile}`}>Checks{stats.checks ? ` · ${stats.checks}` : ""}</button>}
        {!REMOTE && <button className="btn sm" aria-expanded={open === "export"} onClick={() => setOpen(open === "export" ? null : "export")} data-testid={`learn-export-${stats.profile}`} data-tip={folder ? `Saved in ${folder}, keys left out` : undefined}><Download size={13} /> Export</button>}
      </div>
      {open === "checks" && agent && <Checks agent={agent} />}
      {open === "export" && (
        <div className="learn-export">
          <div className="learn-export-row" data-tip={FORMATS.find((f) => f.value === format)!.tip} data-tip-side="top"><Segmented value={format} onChange={setFormat} options={FORMATS.map((f) => ({ value: f.value, label: f.label }))} /></div>
          <div className="learn-export-row"><Segmented value={pick} onChange={setPick} options={[{ value: "good", label: "The good ones" }, { value: "all", label: "All" }]} /><span className="grow" /><button className="btn primary sm" disabled={busy} onClick={() => void run()} data-testid="learn-export-go">Export</button></div>
        </div>
      )}
    </section>
  );
}

export function LearnView() {
  const { graph, boardId } = useBoard();
  const [data, setData] = useState<LearnData | null>(null);
  const ratings = useApp((s) => s.ratings);
  const finished = useApp((s) => Object.values(s.runs).filter((r) => r.status !== "running").length);
  // Checks change the rewards too: ask again when the board's agents change.
  const checksKey = JSON.stringify(graph.nodes.filter((n) => n.kind === "agent").map((n) => [n.id, (n.data as AgentNode["data"]).checks ?? null]));
  useEffect(() => {
    let live = true;
    engine.learn(boardId).then((d) => { if (live) setData(d); }).catch(() => { if (live) setData({ agents: [], folder: "" }); });
    return () => { live = false; };
  }, [boardId, ratings, finished, checksKey]);
  const agents = graph.nodes.filter((n): n is AgentNode => n.kind === "agent");

  return (
    <section className="main">
      <div className="view page-enter learn-view" data-testid="learn">
        <header className="learn-hero">
          <h1 data-tip="Rate answers in Chat, add checks, export, train a model of your own" data-tip-side="bottom">Learn</h1>
        </header>
        {!data ? <SkeletonCards count={3} /> : data.agents.length === 0 ? (
          <div className="empty"><h3>No agents yet</h3></div>
        ) : (
          <div className="learn-list">
            {data.agents.map((a) => <AgentRow key={a.agentNodeId} stats={a} agent={agents.find((n) => n.id === a.agentNodeId)} folder={data.folder} />)}
          </div>
        )}
        <h2 className="learn-sub">Train your model</h2>
        <div className="learn-train">
          {TRAIN.map((t) => (
            <button key={t.label} className="learn-train-row" onClick={() => void openExternal(t.url)}>
              <span className="grow"><b>{t.label}</b><small>{t.sub}</small></span>
              <ExternalLink size={14} className="faint" />
            </button>
          ))}
          <button className="learn-train-row" onClick={() => useApp.getState().openSettings("models")}>
            <span className="grow"><b>Use it</b><small>Settings → Models</small></span>
          </button>
        </div>
      </div>
    </section>
  );
}
