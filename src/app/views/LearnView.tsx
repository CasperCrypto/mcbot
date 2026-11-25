/**
 * Training (Knowledge → Training): your agents' work as data, and a model of your own made from it
 * (src/harness/learn.ts, engine/learn.ts, engine/train.ts). Each agent shows its conversations, thumbs
 * up and down, the mean reward and how many are good enough to train on; its checks grade every answer;
 * Export writes a dataset; Train makes a model: in the cloud (the board's cloud provider's fine-tuning
 * API, then "Use it" wires the new model to the agent) or on this computer (a Trainer agent with Hermes'
 * Unsloth and llama.cpp skills gets an Until-done task).
 */
import { Cpu, Download, Plus, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useEffect, useState } from "react";
import { addEdge, addNode, setNodeField, updateEdge } from "../../board/ydoc";
import type { LearnAgentView, LearnView as LearnData, TrainJob } from "../../contracts/api";
import type { AgentNode, Check, GraphNode } from "../../contracts/graph";
import { CHECK_KINDS, CHECK_LABELS, MIN_TRAIN_EXAMPLES, type DatasetFormat, type DatasetPick } from "../../harness/learn";
import { compileBoard, learnSkills } from "../actions";
import { newId, uniqueName } from "../graph/defaults";
import { freeSpot } from "../graph/place";
import { engine, REMOTE } from "../lib/engine";
import { ago } from "../lib/format";
import { attachModel, chainOf, modelsOf, otherEnd } from "../lib/models";
import { modelSlug } from "../lib/providers";
import { canReveal, revealFile } from "../lib/open";
import { TRAINER_NAME, TRAINER_SKILLS, trainerData, trainerTask } from "../lib/trainer";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { AgentFace, Segmented, SkeletonCards } from "../ui";
import { Picker } from "../Picker";

const FORMATS: { value: DatasetFormat; label: string; tip: string }[] = [
  { value: "chat", label: "Chat", tip: "OpenAI chat format: OpenAI and Together fine-tuning, Unsloth, Hugging Face TRL, MLX" },
  { value: "rewards", label: "With rewards", tip: "Each conversation with its reward from 0 to 1, for preference or RL training" },
  { value: "sharegpt", label: "Hermes", tip: "Hermes' own trajectory format (ShareGPT), for Nous' trajectory and RL tools" },
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
  const [open, setOpen] = useState<"checks" | "export" | "train" | null>(null);
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
        {!REMOTE && agent && <button className="btn sm primary" aria-expanded={open === "train"} onClick={() => setOpen(open === "train" ? null : "train")} data-testid={`learn-train-${stats.profile}`}><Cpu size={13} /> Train</button>}
      </div>
      {open === "checks" && agent && <Checks agent={agent} />}
      {open === "train" && agent && <Train agent={agent} stats={stats} onStarted={() => setOpen(null)} />}
      {open === "export" && (
        <div className="learn-export">
          <div className="learn-export-row" data-tip={FORMATS.find((f) => f.value === format)!.tip} data-tip-side="top"><Segmented value={format} onChange={setFormat} options={FORMATS.map((f) => ({ value: f.value, label: f.label }))} /></div>
          <div className="learn-export-row"><Segmented value={pick} onChange={setPick} options={[{ value: "good", label: "The good ones" }, { value: "all", label: "All" }]} /><span className="grow" /><button className="btn primary sm" disabled={busy} onClick={() => void run()} data-testid="learn-export-go">Export</button></div>
        </div>
      )}
    </section>
  );
}

/** Make a model from an agent's good conversations: in the cloud, or on this computer by a Trainer agent. */
function Train({ agent, stats, onStarted }: { agent: AgentNode; stats: LearnAgentView; onStarted: () => void }) {
  const { graph, doc, boardId } = useBoard();
  const identity = useApp((s) => s.identity);
  const clouds = modelsOf(graph).filter((m) => m.data.endpoint === "cloud");
  const main = chainOf(graph, agent.id).map((e) => clouds.find((m) => m.id === otherEnd(e, agent.id))).find(Boolean);
  const [where, setWhere] = useState<"cloud" | "here">(clouds.length ? "cloud" : "here");
  const [modelId, setModelId] = useState(main?.id ?? clouds[0]?.id ?? "");
  const chosen = clouds.find((m) => m.id === modelId);
  const [base, setBase] = useState(chosen?.data.model ?? "");
  // On this computer the Trainer starts from an open model: never the cloud model's id.
  const [localBase, setLocalBase] = useState("");
  const [pick, setPick] = useState<DatasetPick>("good");
  const [busy, setBusy] = useState(false);
  const name = agent.data.displayName || agent.data.name;
  // What the cloud would get, against the fine-tuning APIs' minimum (the engine refuses fewer too).
  const have = pick === "good" ? stats.good : stats.conversations;
  const enough = have >= MIN_TRAIN_EXAMPLES;

  const cloud = async () => {
    if (!chosen || !base.trim()) return;
    setBusy(true);
    const app = useApp.getState();
    try {
      await engine.startTraining(boardId, agent.id, chosen.id, base.trim(), pick);
      app.toast({ kind: "ok", text: `${chosen.data.label || "The provider"} is training ${name}'s model` });
      onStarted();
    } catch (err) {
      app.toast({ kind: "fail", text: (err as Error).message });
    }
    setBusy(false);
  };

  const here = async () => {
    setBusy(true);
    const app = useApp.getState();
    try {
      const data = await engine.exportDataset(boardId, agent.id, "chat", pick);
      if (!data.examples) throw new Error(pick === "good" ? "Nothing good enough yet: rate some answers, or add checks" : "No finished conversations yet");
      // The Trainer: on the board already, or added now with the same models as this agent.
      if (!graph.nodes.some((n) => n.kind === "agent" && n.data.name === TRAINER_NAME)) {
        const node: GraphNode = { id: newId("agent"), kind: "agent", position: freeSpot(graph, "agent", null, agent.id), data: trainerData() };
        const g = { ...graph, nodes: [...graph.nodes, node] };
        const models = chainOf(graph, agent.id).map((e) => otherEnd(e, agent.id)!);
        doc.transact(() => {
          addNode(doc, node);
          models.forEach((m, i) => {
            const { add, reorder } = attachModel(g, m, [node.id], i === 0, () => newId("edge"));
            for (const e of add) addEdge(doc, { ...e, order: i });
            for (const r of reorder) updateEdge(doc, r.id, { order: r.order });
          });
        });
      }
      if (!(await compileBoard(boardId, { quiet: true }))) throw new Error("Compile the board first (⌘S), then try again");
      await learnSkills(TRAINER_NAME, "Trainer", TRAINER_SKILLS, true);
      const { title, body } = trainerTask({ agent: name, dataset: data.path, examples: data.examples, baseModel: localBase });
      const task = await engine.createTask(boardId, { title, body, assignee: TRAINER_NAME, by: identity.name, goal: true });
      app.toast({ kind: "ok", text: `Trainer is on it: ${data.examples} conversations`, action: { label: "Open", run: () => useApp.getState().showTask(task.id) } });
      onStarted();
    } catch (err) {
      app.toast({ kind: "fail", text: (err as Error).message });
    }
    setBusy(false);
  };

  return (
    <div className="learn-export learn-train-panel" data-testid="learn-train">
      <div className="learn-export-row"><Segmented value={where} onChange={setWhere} options={[{ value: "cloud", label: "In the cloud" }, { value: "here", label: "On this computer" }]} /></div>
      {where === "cloud" ? (
        clouds.length === 0 ? (
          <div className="learn-export-row"><span className="faint grow">No cloud model on this board</span><button className="btn sm" onClick={() => useApp.getState().openSettings("models")}>Add one</button></div>
        ) : (
          <>
            <div className="learn-export-row">
              <Picker sm label="Provider" value={modelId} onChange={(v) => { setModelId(v); setBase(clouds.find((m) => m.id === v)?.data.model ?? base); }}
                options={clouds.map((m) => ({ value: m.id, label: m.data.label || m.data.name, sub: new URL(m.data.baseUrl).hostname }))} />
              <input className="grow" value={base} onChange={(e) => setBase(e.target.value)} placeholder="Model to start from" aria-label="Model to start from" data-tip="One your provider can fine-tune" data-testid="train-base" />
            </div>
            <div className="learn-export-row"><Segmented value={pick} onChange={setPick} options={[{ value: "good", label: "The good ones" }, { value: "all", label: "All" }]} /><span className="grow" />
              {!enough && <span className="faint learn-need" data-tip="Rate answers in Chat or add checks" data-testid="train-need">{have} of {MIN_TRAIN_EXAMPLES}</span>}
              <button className="btn primary sm" disabled={busy || !base.trim() || !enough} onClick={() => void cloud()} data-testid="train-start" data-tip={enough ? `${have} conversation${have === 1 ? "" : "s"}` : `Fine-tuning needs ${MIN_TRAIN_EXAMPLES} or more`}>Start training</button></div>
          </>
        )
      ) : (
        <>
          <div className="learn-export-row"><input className="grow" value={localBase} onChange={(e) => setLocalBase(e.target.value)} placeholder="Open model to start from (the Trainer picks one if empty)" aria-label="Model to start from" data-testid="train-base-here" /></div>
          <div className="learn-export-row"><Segmented value={pick} onChange={setPick} options={[{ value: "good", label: "The good ones" }, { value: "all", label: "All" }]} /><span className="grow" />
            <button className="btn primary sm" disabled={busy} onClick={() => void here()} data-testid="train-here" data-tip="A Trainer agent fine-tunes it with Unsloth and serves it with llama.cpp, until it's done">Give it to the Trainer</button></div>
        </>
      )}
    </div>
  );
}

const STATUS: Record<TrainJob["status"], string> = { validating: "Checking the data", queued: "Waiting its turn", running: "Training", succeeded: "Ready", failed: "Failed", cancelled: "Cancelled" };

/** The board's training jobs in the cloud; a ready model is one click from the agent. */
function Jobs({ jobs, onChange }: { jobs: TrainJob[]; onChange: () => void }) {
  const { graph, doc, boardId } = useBoard();
  const toast = useApp((s) => s.toast);
  const use = (j: TrainJob) => {
    const agent = graph.nodes.find((n) => n.id === j.agentNodeId);
    if (!agent || !j.model) return;
    const name = agent.kind === "agent" ? agent.data.displayName || agent.data.name : j.profile;
    const node: GraphNode = {
      id: newId("model"), kind: "model", position: freeSpot(graph, "model", null, agent.id),
      data: { name: uniqueName(modelSlug(`${j.profile}-trained`), modelsOf(graph).map((m) => m.data.name)), label: `${name}'s model`, endpoint: "cloud", baseUrl: j.baseUrl, model: j.model, apiKeyEnv: j.keyEnv, pricing: null },
    };
    const { add, reorder } = attachModel({ ...graph, nodes: [...graph.nodes, node] }, node.id, [agent.id], true, () => newId("edge"));
    doc.transact(() => {
      addNode(doc, node);
      for (const e of add) addEdge(doc, e);
      for (const r of reorder) updateEdge(doc, r.id, { order: r.order });
    });
    toast({ kind: "ok", text: `${name} now thinks with its own model; the old one is its backup`, action: { label: "Compile", run: () => void compileBoard(boardId) } });
  };
  const cancel = async (j: TrainJob) => {
    try {
      await engine.cancelTraining(j.id);
      onChange();
    } catch (err) {
      toast({ kind: "fail", text: (err as Error).message });
    }
  };
  if (!jobs.length) return null;
  const inUse = new Set(modelsOf(graph).map((m) => m.data.model));
  return (
    <>
      <h2 className="learn-sub">Models</h2>
      <div className="learn-train" data-testid="train-jobs">
        {jobs.map((j) => (
          <div key={j.id} className="learn-train-row" data-status={j.status}>
            <AgentFace seed={j.profile} size={22} status={j.status === "running" || j.status === "queued" || j.status === "validating" ? "running" : null} />
            <span className="grow"><b>{j.model ?? `${j.profile} on ${j.baseModel}`}</b><small>{STATUS[j.status]}{j.error ? `: ${j.error}` : ""} · {j.provider} · {j.examples} conversations · {ago(j.createdAt)}</small></span>
            {j.status === "succeeded" && j.model && (inUse.has(j.model) ? <span className="faint">In use</span> : <button className="btn sm primary" onClick={() => use(j)} data-testid="train-use">Use it</button>)}
            {(j.status === "validating" || j.status === "queued" || j.status === "running") && <button className="btn sm ghost" onClick={() => void cancel(j)}>Cancel</button>}
          </div>
        ))}
      </div>
    </>
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
  // Training jobs in the cloud: asked again every 15 s while one is still going.
  const [jobs, setJobs] = useState<TrainJob[]>([]);
  const [tick, setTick] = useState(0);
  const reloadJobs = () => setTick((t) => t + 1);
  useEffect(() => {
    if (REMOTE) return;
    let live = true;
    engine.trainJobs(boardId).then((j) => { if (live) setJobs(j); }).catch(() => undefined);
    return () => { live = false; };
  }, [boardId, tick]);
  const going = jobs.some((j) => j.status === "validating" || j.status === "queued" || j.status === "running");
  useEffect(() => {
    if (!going) return;
    const t = setInterval(reloadJobs, 15_000);
    return () => clearInterval(t);
  }, [going]);

  return (
    <section className="main">
      <div className="view page-enter learn-view" data-testid="learn">
        <header className="learn-hero">
          <h1 data-tip="Rate answers in Chat, add checks, then train a model of your own" data-tip-side="bottom">Training</h1>
        </header>
        {!data ? <SkeletonCards count={3} /> : data.agents.length === 0 ? (
          <div className="empty"><h3>No agents yet</h3></div>
        ) : (
          <div className="learn-list">
            {data.agents.map((a) => <AgentRow key={a.agentNodeId} stats={a} agent={agents.find((n) => n.id === a.agentNodeId)} folder={data.folder} />)}
          </div>
        )}
        <Jobs jobs={jobs} onChange={reloadJobs} />
      </div>
    </section>
  );
}
