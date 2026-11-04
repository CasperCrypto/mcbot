/**
 * First launch: who McBot is for, who you are, which agents, which model.
 * Ends with a compiled team that already knows who it works for.
 */
import { MeshGradient } from "@paper-design/shaders-react";
import { ArrowLeft, Building2, Check, Cloud, Copy, HardDrive, LoaderCircle, RefreshCw, TriangleAlert, User, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LocalServer, SetupDetect, SetupKind, SetupProfile } from "../../contracts/api";
import { engine } from "../lib/engine";
import { BrandMark } from "../shell/TitleBar";
import { useApp } from "../state/store";
import { AgentFace, Field, Segmented } from "../ui";
import { PRESETS, boardName, buildTeam, defaultPicks, presetsFor, userFacts, type ModelChoice } from "./presets";

type Step = "welcome" | "kind" | "about" | "agents" | "brain" | "build";
const STEPS: Step[] = ["welcome", "kind", "about", "agents", "brain", "build"];

const CLOUDS = [
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", key: "OPENROUTER_API_KEY" },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", key: "OPENAI_API_KEY" },
  { id: "other", label: "Other", baseUrl: "", key: "MCBOT_CLOUD_API_KEY" },
] as const;
type CloudId = (typeof CLOUDS)[number]["id"];

const KINDS: { kind: SetupKind; title: string; sub: string; icon: ReactNode }[] = [
  { kind: "personal", title: "Just me", sub: "An assistant and helpers", icon: <User size={22} /> },
  { kind: "team", title: "My team", sub: "Agents your team shares", icon: <Users size={22} /> },
  { kind: "company", title: "My company", sub: "Agents for every department", icon: <Building2 size={22} /> },
];

/** McBot ships its own Hermes (hermes/); from source it needs one setup run. */
const INSTALL = "npm run hermes:setup";

type Status = "wait" | "busy" | "ok" | "warn" | "fail";
interface Row { label: string; status: Status; detail?: string }

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function SetupAssistant({ onDone }: { onDone: (boardId: string | null, agentNodeId: string | null) => void }) {
  const identity = useApp((s) => s.identity);
  const setIdentity = useApp((s) => s.setIdentity);
  const health = useApp((s) => s.health);
  const [step, setStep] = useState<Step>("welcome");
  const [profile, setProfile] = useState<SetupProfile>({ kind: "personal", name: identity.name, company: "", about: "", role: "" });
  const [picks, setPicks] = useState<string[]>(defaultPicks("personal"));
  const [detect, setDetect] = useState<SetupDetect | null>(null);
  const [local, setLocal] = useState<{ server: LocalServer; model: string } | null>(null);
  const [cloudId, setCloudId] = useState<CloudId>("openrouter");
  const [cloud, setCloud] = useState({ key: "", model: "", baseUrl: "", saved: false, models: null as string[] | null, error: "" });
  const [rows, setRows] = useState<Row[]>([]);
  const [result, setResult] = useState<{ boardId: string; agentNodeId: string | null } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const provider = CLOUDS.find((c) => c.id === cloudId)!;
  const company = profile.kind !== "personal";
  const index = STEPS.indexOf(step);
  const go = (s: Step) => setStep(s);

  // McBot's own Hermes prepares itself in the background from the first screen (minutes on first launch).
  const prep = useRef<Promise<boolean> | null>(null);
  const [prepLine, setPrepLine] = useState<string | null>(null);
  const prepareHermes = () => (prep.current ??= (async () => {
    let info = await engine.prepareHermes().catch(() => null);
    while (info?.setup.state === "running") {
      setPrepLine(info.setup.lines.at(-1) ?? null);
      await pause(1000);
      info = await engine.hermes().catch(() => info);
    }
    setPrepLine(info?.setup.lines.at(-1) ?? null);
    return info?.setup.state === "done";
  })());

  const runDetect = async () => {
    setDetect(null);
    const d = await engine.setupDetect().catch(() => ({ hermes: { found: false, path: null }, local: [], secrets: [] }) as SetupDetect);
    setDetect(d);
    if (!d.hermes.found && d.hermes.source) void prepareHermes();
    if (!local && d.local[0]?.models[0]) {
      const server = d.local[0];
      setLocal({ server, model: server.models.find((m) => /qwen|llama|gemma|mistral/i.test(m)) ?? server.models[0]! });
    }
  };
  useEffect(() => {
    void runDetect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setCloud((c) => ({ ...c, saved: !!detect?.secrets.includes(provider.key), models: null, error: "" }));
  }, [cloudId, detect]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveKey = async () => {
    try {
      await engine.setSecret(provider.key, cloud.key);
      setCloud((c) => ({ ...c, key: "", saved: true, error: "" }));
      const base = provider.id === "other" ? cloud.baseUrl : provider.baseUrl;
      if (base) {
        const { models } = await engine.setupModels(base, provider.key).catch(() => ({ models: null }));
        setCloud((c) => ({ ...c, models }));
      }
    } catch (err) {
      setCloud((c) => ({ ...c, error: (err as Error).message }));
    }
  };

  const cloudBase = provider.id === "other" ? cloud.baseUrl.trim() : provider.baseUrl;
  const cloudReady = cloud.saved && !!cloud.model.trim() && /^https?:\/\//.test(cloudBase);
  const models = useMemo<ModelChoice[]>(() => {
    const out: ModelChoice[] = [];
    if (local) out.push({ endpoint: "local", label: local.server.name, baseUrl: local.server.baseUrl, model: local.model, apiKeyEnv: "" });
    if (cloudReady) out.push({ endpoint: "cloud", label: provider.label, baseUrl: cloudBase, model: cloud.model.trim(), apiKeyEnv: provider.key });
    return out;
  }, [local, cloudReady, provider, cloudBase, cloud.model]);

  const build = async (withModels: ModelChoice[]) => {
    go("build");
    setFailed(null);
    const workspace = health?.workspace ?? "~/McBot";
    const hermesOk = !!detect?.hermes.found;
    const preparing = !hermesOk && !!detect?.hermes.source;
    const plan: Row[] = [
      preparing ? { label: "Preparing Hermes", status: "busy", detail: "first launch, a few minutes" }
        : { label: hermesOk ? (detect?.hermes.kind === "bundled" ? "Hermes is built in" : "Hermes is ready") : "Hermes isn't set up yet", status: hermesOk ? "ok" : "warn" },
      { label: "Building your board", status: "wait" },
      { label: "Writing your agents", status: withModels.length ? "wait" : "warn", detail: withModels.length ? undefined : "Add a model on the board, then compile" },
      { label: "Telling them who you are", status: withModels.length ? "wait" : "warn" },
    ];
    setRows(plan);
    const set = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    try {
      if (profile.name.trim() && profile.name.trim() !== identity.name) setIdentity({ ...identity, name: profile.name.trim() });
      if (preparing) {
        const ok = await prepareHermes();
        set(0, ok ? { label: "Hermes is built in", status: "ok", detail: undefined } : { label: "Hermes couldn't be prepared", status: "warn", detail: "McBot tries again on the first run" });
        if (ok) setDetect((d) => (d ? { ...d, hermes: { ...d.hermes, found: true, kind: "bundled" } } : d));
      }
      set(1, { status: "busy" });
      const graph = buildTeam(profile, picks, withModels, workspace);
      const board = await engine.setupBoard(boardName(profile), graph);
      await pause(350);
      set(1, { status: "ok", detail: board.name });
      const first = graph.nodes.find((n) => n.kind === "agent")?.id ?? null;
      if (withModels.length) {
        set(2, { status: "busy" });
        const res = await engine.compile(board.id);
        await pause(350);
        if (!res.ok) {
          set(2, { status: "fail", detail: res.error });
        } else {
          const written = res.report.changes.filter((c) => c.status !== "unchanged").length;
          set(2, { status: "ok", detail: `${written} files` });
          set(3, { status: "busy" });
          const fact = userFacts(profile);
          if (fact) {
            const agents = graph.nodes.filter((n) => n.kind === "agent").map((n) => (n.data as { name: string }).name);
            await Promise.all(agents.map((a) => engine.saveMemory(a, "user", [fact], null).catch(() => null)));
          }
          await pause(350);
          set(3, { status: "ok", detail: fact ? "USER.md" : undefined });
        }
      }
      await engine.setupComplete(profile);
      setResult({ boardId: board.id, agentNodeId: first });
    } catch (err) {
      setFailed((err as Error).message);
    }
  };

  const skipAll = async () => {
    await engine.setupComplete(null).catch(() => null);
    onDone(null, null);
  };

  const canNext: Record<Step, boolean> = {
    welcome: true,
    kind: true,
    about: profile.name.trim().length > 0 && (!company || profile.company.trim().length > 0),
    agents: picks.length > 0,
    brain: models.length > 0,
    build: !!result,
  };

  const next = () => {
    if (step === "brain") void build(models);
    else go(STEPS[index + 1]!);
  };

  return (
    <div className="setup" data-testid="setup">
      <div className="setup-drag" data-tauri-drag-region />
      <div className="setup-glow" aria-hidden>
        <MeshGradient style={{ width: "100%", height: "100%" }} colors={["#2a2350", "#16243f", "#121214", "#2b1d3f"]} distortion={0.9} swirl={0.5} speed={0.12} />
      </div>
      <main className="setup-body" key={step}>
        {step === "welcome" && (
          <div className="setup-hero">
            <BrandMark size={64} />
            <h1>Welcome to McBot</h1>
            <p>Build a team of AI agents that works on your computer.</p>
          </div>
        )}

        {step === "kind" && (
          <>
            <h1>Who is McBot for?</h1>
            <div className="setup-choices">
              {KINDS.map((k) => (
                <button key={k.kind} className="choice" aria-pressed={profile.kind === k.kind} data-testid={`setup-kind-${k.kind}`}
                  onClick={() => { setProfile({ ...profile, kind: k.kind }); setPicks(defaultPicks(k.kind)); }}>
                  <span className="choice-icon">{k.icon}</span>
                  <b>{k.title}</b>
                  <small>{k.sub}</small>
                </button>
              ))}
            </div>
          </>
        )}

        {step === "about" && (
          <>
            <h1>{company ? "About your company" : "About you"}</h1>
            <div className="setup-form">
              <Field label="Your name" value={profile.name} onChange={(v) => setProfile({ ...profile, name: v })} testId="setup-name" />
              {company ? (
                <>
                  <Field label="Company" value={profile.company} onChange={(v) => setProfile({ ...profile, company: v })} placeholder="Acme" testId="setup-company" />
                  <Field label="What it does" value={profile.about} onChange={(v) => setProfile({ ...profile, about: v })} placeholder="Invoicing software for small shops" testId="setup-about" />
                  <Field label="Your role" value={profile.role} onChange={(v) => setProfile({ ...profile, role: v })} placeholder="Head of support" testId="setup-role" />
                </>
              ) : (
                <Field label="What should McBot help with?" value={profile.about} onChange={(v) => setProfile({ ...profile, about: v })} placeholder="Plan my week, answer email, research" testId="setup-about" />
              )}
            </div>
          </>
        )}

        {step === "agents" && (
          <>
            <h1>Pick your first agents</h1>
            <div className="setup-agents">
              {presetsFor(profile.kind).map((p) => {
                const on = picks.includes(p.id);
                return (
                  <button key={p.id} className="agent-pick" aria-pressed={on} data-testid={`setup-agent-${p.id}`}
                    onClick={() => setPicks(on ? picks.filter((x) => x !== p.id) : [...picks, p.id])}>
                    <AgentFace seed={p.name} size={40} />
                    <span className="grow"><b>{p.displayName}</b><small>{p.role}</small></span>
                    <span className="tick">{on && <Check size={13} strokeWidth={3} />}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {step === "brain" && (
          <>
            <h1>Choose a model</h1>
            <section className="setup-section">
              <header><HardDrive size={14} /> On this computer {detect && <button className="icon-btn sm" aria-label="Check again" data-tip="Check again" onClick={() => void runDetect()}><RefreshCw size={12} /></button>}</header>
              {!detect ? (
                <div className="setup-row muted"><LoaderCircle size={15} className="spin-icon" /> Looking for Ollama and LM Studio…</div>
              ) : detect.local.length === 0 ? (
                <div className="setup-row muted">
                  <span className="grow">No local model found</span>
                  <a className="btn sm" href="https://ollama.com/download" target="_blank" rel="noreferrer">Get Ollama</a>
                </div>
              ) : (
                <div className="setup-models" role="radiogroup" aria-label="Local models">
                  {detect.local.flatMap((s) => s.models.map((m) => {
                    const on = local?.server.baseUrl === s.baseUrl && local.model === m;
                    return (
                      <button key={`${s.name}/${m}`} role="radio" aria-checked={on} className="model-pick" data-testid="setup-local-model"
                        onClick={() => setLocal(on ? null : { server: s, model: m })}>
                        <span className="dot-radio" /><span className="mono grow">{m}</span><small>{s.name}</small>
                      </button>
                    );
                  }))}
                </div>
              )}
            </section>

            <section className="setup-section">
              <header><Cloud size={14} /> In the cloud</header>
              <Segmented value={cloudId} onChange={(v) => setCloudId(v)} options={CLOUDS.map((c) => ({ value: c.id, label: c.label }))} />
              {provider.id === "other" && (
                <Field label="Address" value={cloud.baseUrl} onChange={(v) => setCloud({ ...cloud, baseUrl: v })} placeholder="https://api.example.com/v1" mono />
              )}
              {cloud.saved ? (
                <div className="setup-row"><Check size={14} className="ok-text" /> <span className="grow">Key saved on this computer</span>
                  <button className="btn ghost sm" onClick={() => setCloud({ ...cloud, saved: false })}>Change</button></div>
              ) : (
                <div className="setup-key">
                  <Field label="API key" type="password" value={cloud.key} onChange={(v) => setCloud({ ...cloud, key: v, error: "" })} placeholder="Paste your key" error={cloud.error || null} testId="setup-key" />
                  <button className="btn" disabled={!cloud.key.trim()} onClick={() => void saveKey()} data-testid="setup-save-key">Save</button>
                </div>
              )}
              <label className="field">
                <span>Model</span>
                <input className="mono" list="setup-cloud-models" value={cloud.model} placeholder={cloud.models ? "Pick or type a model" : "Model name from your provider"} onChange={(e) => setCloud({ ...cloud, model: e.target.value })} data-testid="setup-cloud-model" />
                <datalist id="setup-cloud-models">{(cloud.models ?? []).slice(0, 400).map((m) => <option key={m} value={m} />)}</datalist>
              </label>
            </section>
            {local && cloudReady && <p className="setup-note">The cloud model takes over when the local one can't answer.</p>}
          </>
        )}

        {step === "build" && (
          <>
            <h1>{result ? "Your team is ready" : failed ? "Something went wrong" : "Setting up"}</h1>
            <div className="setup-faces">
              {PRESETS.filter((p) => picks.includes(p.id)).map((p) => (
                <span key={p.id} data-tip={p.displayName}><AgentFace seed={p.name} size={46} status={result ? "succeeded" : "running"} /></span>
              ))}
            </div>
            <ul className="setup-checks">
              {rows.map((r) => (
                <li key={r.label} data-status={r.status}>
                  <span className="mark">{r.status === "busy" ? <LoaderCircle size={15} className="spin-icon" /> : r.status === "ok" ? <Check size={15} strokeWidth={3} /> : r.status === "wait" ? null : <TriangleAlert size={14} />}</span>
                  <span className="grow">{r.label}</span>
                  {(r.status === "busy" && r.label === "Preparing Hermes" && prepLine ? prepLine : r.detail) && (
                    <small className="mono ellipsis" style={{ maxWidth: 260 }}>{r.status === "busy" && r.label === "Preparing Hermes" && prepLine ? prepLine : r.detail}</small>
                  )}
                </li>
              ))}
            </ul>
            {!detect?.hermes.found && !detect?.hermes.source && <InstallHermes />}
            {failed && <p className="setup-note fail-text">{failed}</p>}
          </>
        )}
      </main>

      <footer className="setup-foot">
        <div className="setup-foot-inner">
          {index > 0 && step !== "build" ? (
            <button className="btn ghost" onClick={() => go(STEPS[index - 1]!)}><ArrowLeft size={14} /> Back</button>
          ) : step === "welcome" ? (
            <button className="btn ghost" onClick={() => void skipAll()} data-testid="setup-skip">Skip setup</button>
          ) : failed ? (
            <button className="btn ghost" onClick={() => go("brain")}><ArrowLeft size={14} /> Back</button>
          ) : <span />}
          <Dots index={index} />
          {step === "build" ? (
            <button className="btn primary lg" disabled={!result} onClick={() => result && onDone(result.boardId, result.agentNodeId)} data-testid="setup-finish">
              {result?.agentNodeId ? "Start chatting" : "Open McBot"}
            </button>
          ) : (
            <div className="row">
              {step === "brain" && <button className="btn ghost" onClick={() => void build([])} data-testid="setup-later">Later</button>}
              <button className="btn primary lg" disabled={!canNext[step]} onClick={next} data-testid="setup-next">
                {step === "welcome" ? "Get started" : step === "brain" ? "Build my team" : "Continue"}
              </button>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}

function Dots({ index }: { index: number }) {
  return (
    <div className="setup-dots" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
      {STEPS.map((s, i) => <i key={s} data-on={i === index || undefined} data-done={i < index || undefined} />)}
    </div>
  );
}

function InstallHermes() {
  const [copied, setCopied] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (t.current) clearTimeout(t.current);
    };
  }, []);
  return (
    <div className="setup-install">
      <code className="mono">{INSTALL}</code>
      <button className="icon-btn" aria-label="Copy" data-tip={copied ? "Copied" : "Copy"} onClick={() => {
        void navigator.clipboard?.writeText(INSTALL).then(() => { setCopied(true); t.current = setTimeout(() => setCopied(false), 1500); }).catch(() => undefined);
      }}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
    </div>
  );
}
