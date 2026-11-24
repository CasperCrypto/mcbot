/**
 * First launch, step by step: who McBot is for, who you are, what your business does and for whom,
 * what the agents should get done and in what voice, the team for that (with the tools and makers
 * that let it do the work, not just talk about it), a model, the keys those tools need.
 * Ends with a compiled team that knows your business (the board's brief, in every SOUL.md).
 */
import { ArrowLeft, Building2, Check, Cloud, Copy, FolderOpen, Globe, HardDrive, ImageIcon, LoaderCircle, RefreshCw, TriangleAlert, User, Users } from "lucide-react";
import { FrameStrip } from "../shell/WindowControls";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LocalServer, SetupDetect, SetupKind, SetupProfile } from "../../contracts/api";
import { engine } from "../lib/engine";
import { openExternal } from "../lib/open";
import { BrandMark } from "../shell/TitleBar";
import { useApp } from "../state/store";
import { nameChosen } from "../lib/identity";
import { AgentFace, Field } from "../ui";
import { CLOUD_PROVIDERS } from "../lib/providers";
import { boardName, userFacts, type ModelChoice } from "./presets";
import { CHANNELS, GOALS, HUGGING_FACE, VOICES, briefFromSetup, buildSetupBoard, defaultGoals, emptyAnswers, listed, memberKey, setupNeeds, teamsFor, toggleListed, withoutSkipped, type SetupAnswers } from "./onboarding";
import { MEDIA_PROVIDERS } from "../../contracts/graph";
import { learnTeamSkills } from "../actions";
import { REMOTE } from "../lib/engine";

type Step = "welcome" | "kind" | "about" | "business" | "goals" | "team" | "brain" | "tools" | "build";
const STEPS: Step[] = ["welcome", "kind", "about", "business", "goals", "team", "brain", "tools", "build"];

/** Image services offered in setup, with where to get a key (all Hermes' own image plugins, MEDIA_PROVIDERS). */
const IMAGE_SERVICES: { id: keyof typeof MEDIA_PROVIDERS.image; keysUrl: string }[] = [
  { id: "openrouter", keysUrl: "https://openrouter.ai/keys" },
  { id: "openai", keysUrl: "https://platform.openai.com/api-keys" },
  { id: "fal", keysUrl: "https://fal.ai/dashboard/keys" },
  { id: "xai", keysUrl: "https://console.x.ai" },
];

/** Every preset is an OpenAI-compatible address (src/app/lib/providers.ts); "Other" is any such API. */
const CLOUDS = [
  ...CLOUD_PROVIDERS.map((p) => ({ id: p.id, label: p.label, baseUrl: p.baseUrl, key: p.keyEnv, keysUrl: p.keysUrl, model: p.model })),
  { id: "other", label: "Other…", baseUrl: "", key: "MCBOT_CLOUD_API_KEY", keysUrl: "", model: "" },
];
type CloudId = string;

const KINDS: { kind: SetupKind; title: string; sub: string; icon: ReactNode }[] = [
  { kind: "personal", title: "Just me", sub: "An assistant and helpers", icon: <User size={22} /> },
  { kind: "team", title: "My team", sub: "Agents your team shares", icon: <Users size={22} /> },
  { kind: "company", title: "My company", sub: "Agents for every department", icon: <Building2 size={22} /> },
];

/** McBot ships its own Hermes (hermes/); from source it needs one setup run. */
const INSTALL = "npm run engine:setup";

type Status = "wait" | "busy" | "ok" | "warn" | "fail";
interface Row { label: string; status: Status; detail?: string }

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function SetupAssistant({ onDone }: { onDone: (boardId: string | null, agentNodeId: string | null) => void }) {
  const identity = useApp((s) => s.identity);
  const setIdentity = useApp((s) => s.setIdentity);
  const health = useApp((s) => s.health);
  const [step, setStep] = useState<Step>("welcome");
  // A second run starts from the first one's answers; a made-up name is never filled in.
  const earlier = useApp((s) => s.setup?.profile ?? null);
  const [profile, setProfile] = useState<SetupProfile>(earlier ?? { kind: "personal", name: nameChosen(identity) ? identity.name : "", company: "", about: "", role: "" });
  const [answers, setAnswers] = useState<SetupAnswers>(emptyAnswers);
  const answer = (k: keyof SetupAnswers, v: string) => setAnswers((a) => ({ ...a, [k]: v }));
  const [goals, setGoals] = useState<string[]>(defaultGoals(earlier?.kind ?? "personal"));
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [maker, setMaker] = useState<string | null>(null);
  const [makerKey, setMakerKey] = useState({ value: "", saved: false, error: "" });
  /** The agent that makes images through Hugging Face, to sign in once the team is built. */
  const hfAgent = useRef<string | null>(null);
  const [hfSigning, setHfSigning] = useState<"idle" | "busy" | "started" | "failed">("idle");
  const [detect, setDetect] = useState<SetupDetect | null>(null);
  const [local, setLocal] = useState<{ server: LocalServer; model: string } | null>(null);
  const [cloudId, setCloudId] = useState<CloudId>("openrouter");
  const [cloud, setCloud] = useState({ key: "", model: CLOUDS[0]!.model, baseUrl: "", saved: false, models: null as string[] | null, error: "" });
  const [custom, setCustom] = useState({ url: "", state: "idle" as "idle" | "busy" | "none" });
  const [rows, setRows] = useState<Row[]>([]);
  const [result, setResult] = useState<{ boardId: string; agentNodeId: string | null } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const provider = CLOUDS.find((c) => c.id === cloudId)!;
  const company = profile.kind !== "personal";
  const index = STEPS.indexOf(step);
  const go = (s: Step) => setStep(s);
  const teams = useMemo(() => teamsFor(goals), [goals]);
  const kept = useMemo(() => teams.map((t) => withoutSkipped(t, skip)).filter((t): t is NonNullable<typeof t> => !!t), [teams, skip]);
  const needs = setupNeeds(kept);

  // McBot's engine prepares itself in the background from the first screen (minutes on first launch).
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

  /** A local server at an address of the person's own (another port, another computer). */
  const checkCustom = async () => {
    const url = custom.url.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//.test(url)) return setCustom({ ...custom, state: "none" });
    const base = /\/v1$/.test(url) ? url : `${url}/v1`;
    setCustom({ ...custom, state: "busy" });
    const { models: found } = await engine.setupModels(base).catch(() => ({ models: null }));
    if (!found?.length) return setCustom({ ...custom, state: "none" });
    const server: LocalServer = { name: "Local server", baseUrl: base, models: found };
    setDetect((d) => (d ? { ...d, local: [...d.local.filter((x) => x.baseUrl !== base), server] } : d));
    setLocal({ server, model: found[0]! });
    setCustom({ url: "", state: "idle" });
  };

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

  // The image service: the one the cloud model's key also runs, unless the person picks another.
  const KEY_SERVICE: Record<string, string> = { OPENROUTER_API_KEY: "openrouter", OPENAI_API_KEY: "openai", XAI_API_KEY: "xai" };
  const sharedService = models.map((m) => KEY_SERVICE[m.apiKeyEnv]).find(Boolean) ?? null;
  // No cloud key that also makes images: Hugging Face, free with an account.
  const choice = maker ?? sharedService ?? HUGGING_FACE;
  const viaHf = choice === HUGGING_FACE;
  const service = (viaHf ? "openrouter" : choice) as keyof typeof MEDIA_PROVIDERS.image;
  const serviceKey = MEDIA_PROVIDERS.image[service].keyEnv;
  const serviceKeySaved = viaHf || makerKey.saved || !!detect?.secrets.includes(serviceKey) || (cloud.saved && provider.key === serviceKey);
  useEffect(() => {
    setMakerKey((k) => ({ ...k, saved: false, error: "" }));
  }, [service]);
  const saveMakerKey = async () => {
    try {
      await engine.setSecret(serviceKey, makerKey.value.trim());
      setMakerKey({ value: "", saved: true, error: "" });
    } catch (err) {
      setMakerKey((k) => ({ ...k, error: (err as Error).message }));
    }
  };

  const build = async (withModels: ModelChoice[]) => {
    go("build");
    setFailed(null);
    const workspace = health?.workspace ?? "~/McBot";
    const hermesOk = !!detect?.hermes.found;
    const preparing = !hermesOk && !!detect?.hermes.source;
    const plan: Row[] = [
      preparing ? { label: "Preparing the engine", status: "busy", detail: "first launch, a few minutes" }
        : { label: hermesOk ? (detect?.hermes.kind === "bundled" ? "Hermes is built in" : "Hermes is ready") : "Hermes isn't set up yet", status: hermesOk ? "ok" : "warn" },
      { label: "Building your team", status: "wait" },
      { label: "Writing your agents", status: withModels.length ? "wait" : "warn", detail: withModels.length ? undefined : "Add a model on the board, then compile" },
      { label: "Teaching them your business", status: withModels.length ? "wait" : "warn" },
    ];
    setRows(plan);
    const set = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    try {
      if (profile.name.trim() && profile.name.trim() !== identity.name) setIdentity({ ...identity, name: profile.name.trim(), chosen: true });
      if (preparing) {
        const ok = await prepareHermes();
        set(0, ok ? { label: "Engine ready", status: "ok", detail: undefined } : { label: "The engine couldn't be prepared", status: "warn", detail: "McBot tries again on the first run" });
        if (ok) setDetect((d) => (d ? { ...d, hermes: { ...d.hermes, found: true, kind: "bundled" } } : d));
      }
      set(1, { status: "busy" });
      const brief = briefFromSetup(profile, answers);
      const { graph, lead, skills } = buildSetupBoard({ profile, brief, teams, skip, models: withModels, workspace, maker: choice });
      hfAgent.current = viaHf ? (graph.nodes.find((n) => n.kind === "agent" && graph.edges.some((e) => e.source === n.id && graph.nodes.find((t) => t.id === e.target && t.kind === "tool" && t.data.name === "hugging_face")))?.data as { name?: string } | undefined)?.name ?? null : null;
      const board = await engine.setupBoard(boardName(profile), graph);
      await pause(350);
      const agentCount = graph.nodes.filter((n) => n.kind === "agent").length;
      set(1, { status: "ok", detail: `${agentCount} agent${agentCount === 1 ? "" : "s"} · ${board.name}` });
      const first = lead ?? graph.nodes.find((n) => n.kind === "agent")?.id ?? null;
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
          set(3, { status: "ok", detail: graph.brief ? "in every SOUL.md" : fact ? "USER.md" : undefined });
          // Their Hermes skills install in the background, one agent after another (notices say how it went).
          if (skills.length && !REMOTE) void learnTeamSkills("Your team", skills);
        }
      }
      await engine.setupComplete(profile);
      setResult({ boardId: board.id, agentNodeId: first });
    } catch (err) {
      setFailed((err as Error).message);
    }
  };

  const skipAll = async () => {
    // Skipping a second run keeps what the first one was told (your name for invites, the company).
    await engine.setupComplete(useApp.getState().setup?.profile ?? null).catch(() => null);
    onDone(null, null);
  };

  const canNext: Record<Step, boolean> = {
    welcome: true,
    kind: true,
    about: profile.name.trim().length > 0 && (!company || profile.company.trim().length > 0),
    business: !company || profile.about.trim().length > 0,
    goals: goals.length > 0,
    team: kept.length > 0,
    brain: models.length > 0,
    tools: true,
    build: !!result,
  };

  const next = () => {
    if (step === "tools") void build(models);
    else go(STEPS[index + 1]!);
  };

  return (
    <div className="setup" data-testid="setup">
      <FrameStrip />
      {step !== "build" && step !== "welcome" && <button className="btn ghost sm setup-skip" onClick={() => void skipAll()} data-testid="setup-skip-top">Skip setup</button>}
      <div className="setup-drag" data-tauri-drag-region />
      <main className="setup-body" key={step}>
        {step === "welcome" && (
          <div className="setup-hero">
            <BrandMark size={64} />
            <h1>Welcome to McBot Studio</h1>
            <p>Build a team of AI agents that works on your computer.</p>
          </div>
        )}

        {step === "kind" && (
          <>
            <h1>Who is McBot for?</h1>
            <div className="setup-choices">
              {KINDS.map((k) => (
                <button key={k.kind} className="choice" aria-pressed={profile.kind === k.kind} data-testid={`setup-kind-${k.kind}`}
                  onClick={() => { setProfile({ ...profile, kind: k.kind }); setGoals(defaultGoals(k.kind)); }}>
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
            <h1>About you</h1>
            <div className="setup-form">
              <Field label="Your name" value={profile.name} onChange={(v) => setProfile({ ...profile, name: v })} testId="setup-name" />
              {company && (
                <>
                  <Field label={profile.kind === "team" ? "Team or company" : "Company"} value={profile.company} onChange={(v) => setProfile({ ...profile, company: v })} placeholder="Northwind Bakery" testId="setup-company" />
                  <Field label="Your role" value={profile.role} onChange={(v) => setProfile({ ...profile, role: v })} placeholder="Owner" testId="setup-role" />
                </>
              )}
            </div>
          </>
        )}

        {step === "business" && (
          <>
            <h1>{company ? `What ${profile.company.trim() || "your company"} does` : "What you do"}</h1>
            <div className="setup-form">
              <label className="field">
                <span>{company ? "What you do" : "What you do, and what you'd like help with"}</span>
                <textarea rows={3} maxLength={600} value={profile.about} onChange={(e) => setProfile({ ...profile, about: e.target.value })}
                  placeholder={company ? "Sourdough, pastries and cakes, baked every morning. A café and online orders." : "I run a small design studio; help me with clients, invoices and posts."} data-testid="setup-about" />
              </label>
              {company && (
                <label className="field">
                  <span>Products and prices <small className="faint">optional</small></span>
                  <textarea rows={2} value={answers.offer} onChange={(e) => answer("offer", e.target.value)} placeholder="Loaves from £4, celebration cakes from £35, a weekly bread subscription" data-testid="setup-offer" />
                </label>
              )}
              <label className="field">
                <span>{company ? "Your customers" : "Who you work with"} <small className="faint">optional</small></span>
                <textarea rows={2} value={answers.customers} onChange={(e) => answer("customers", e.target.value)} placeholder={company ? "Local families, office lunch orders, people planning a celebration" : "Small businesses, mostly cafés and shops"} data-testid="setup-customers" />
              </label>
              <Field label="Website or profiles (optional)" value={answers.links} onChange={(v) => answer("links", v)} placeholder="northwindbakery.co.uk · instagram.com/northwindbakes" testId="setup-links" />
            </div>
          </>
        )}

        {step === "goals" && (
          <>
            <h1>What should your agents get done?</h1>
            <div className="setup-goals" role="group" aria-label="Goals">
              {GOALS.map((g) => {
                const on = goals.includes(g.id);
                return (
                  <button key={g.id} className="goal-pick" aria-pressed={on} data-testid={`setup-goal-${g.id}`}
                    onClick={() => setGoals(on ? goals.filter((x) => x !== g.id) : [...goals, g.id])}>
                    <b>{g.label}</b><small>{g.sub}</small>
                    <span className="tick">{on && <Check size={12} strokeWidth={3} />}</span>
                  </button>
                );
              })}
            </div>
            <div className="setup-form">
              <label className="field">
                <span>Your goals right now <small className="faint">optional</small></span>
                <textarea rows={2} value={answers.goals} onChange={(e) => answer("goals", e.target.value)} placeholder="Post 4 times a week · 500 newsletter subscribers by June · launch online cake orders" data-testid="setup-goals-text" />
              </label>
              <div className="field">
                <span>Voice</span>
                <div className="chip-row">
                  {VOICES.map((v) => <button key={v} type="button" className="pick-chip" aria-pressed={listed(answers.voice, v)} onClick={() => answer("voice", toggleListed(answers.voice, v))}>{v}</button>)}
                </div>
              </div>
              <div className="field">
                <span>Where you show up</span>
                <div className="chip-row">
                  {CHANNELS.map((c) => <button key={c} type="button" className="pick-chip" aria-pressed={listed(answers.channels, c)} onClick={() => answer("channels", toggleListed(answers.channels, c))}>{c}</button>)}
                </div>
              </div>
            </div>
          </>
        )}

        {step === "team" && (
          <>
            <h1>Your team</h1>
            <div className="setup-teams">
              {teams.map((t) => (
                <section key={t.id} className="setup-team">
                  <header><b>{t.label}</b><small>{t.does}</small></header>
                  <div className="setup-members">
                    {t.members.map((m, i) => {
                      const k = memberKey(t, m.name);
                      const on = !skip.has(k);
                      return (
                        <button key={k} className="agent-pick" aria-pressed={on} data-testid={`setup-member-${m.name}`}
                          onClick={() => setSkip((x) => { const n = new Set(x); if (on) n.add(k); else n.delete(k); return n; })}>
                          <AgentFace seed={m.name} size={38} />
                          <span className="grow">
                            <b>{m.displayName}{i === 0 && t.members.length > 1 ? <span className="faint"> · lead</span> : null}</b>
                            <small>{m.description}</small>
                            {(m.makers?.length || m.tools?.length) ? (
                              <span className="member-can">
                                {m.makers?.includes("image") && <span><ImageIcon size={12} /> Makes images</span>}
                                {m.makers?.includes("video") && <span><ImageIcon size={12} /> Makes videos</span>}
                                {m.tools?.includes("exa") && <span><Globe size={12} /> Searches the web</span>}
                              </span>
                            ) : null}
                          </span>
                          <span className="tick">{on && <Check size={13} strokeWidth={3} />}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
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
                  <a className="btn sm" href="https://ollama.com/download" target="_blank" rel="noreferrer" onClick={(e) => { e.preventDefault(); void openExternal("https://ollama.com/download"); }}>Get Ollama</a>
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
              <div className="setup-key">
                <Field label="Running somewhere else?" value={custom.url} onChange={(v) => setCustom({ url: v, state: "idle" })} placeholder="http://127.0.0.1:8080/v1" mono
                  error={custom.state === "none" ? "No OpenAI-compatible server answered there" : null} testId="setup-local-url" />
                <button className="btn" disabled={!custom.url.trim() || custom.state === "busy"} onClick={() => void checkCustom()}>{custom.state === "busy" ? <LoaderCircle size={13} className="spin-icon" /> : "Check"}</button>
              </div>
            </section>

            <section className="setup-section">
              <header><Cloud size={14} /> In the cloud</header>
              <div className="provider-grid" role="radiogroup" aria-label="Provider">
                {CLOUDS.map((c) => (
                  <button key={c.id} role="radio" aria-checked={cloudId === c.id} className="provider-pick" data-testid={`setup-provider-${c.id}`}
                    onClick={() => { setCloudId(c.id); setCloud((x) => ({ ...x, model: c.model })); }}>{c.label}</button>
                ))}
              </div>
              {provider.id === "other" && (
                <Field label="Address" value={cloud.baseUrl} onChange={(v) => setCloud({ ...cloud, baseUrl: v })} placeholder="https://api.example.com/v1" mono />
              )}
              {cloud.saved ? (
                <div className="setup-row"><Check size={14} className="ok-text" /> <span className="grow">Key saved on this computer</span>
                  <button className="btn ghost sm" onClick={() => setCloud({ ...cloud, saved: false })}>Change</button></div>
              ) : (
                <div className="setup-key">
                  <Field label="API key" type="password" value={cloud.key} onChange={(v) => setCloud({ ...cloud, key: v, error: "" })} placeholder="Paste your key" error={cloud.error || null} testId="setup-key"
                    note={provider.keysUrl ? <button className="link-btn" style={{ padding: 0 }} onClick={() => void openExternal(provider.keysUrl)}>Get your {provider.label} key ↗</button> : undefined} />
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

        {step === "tools" && (
          <>
            <h1>Tools</h1>
            {(needs.image || needs.video) && (
              <section className="setup-section" data-testid="setup-images">
                <header><ImageIcon size={14} /> Images{needs.video ? " and video" : ""}</header>
                <div className="provider-grid" role="radiogroup" aria-label="Image service">
                  <button role="radio" aria-checked={viaHf} className="provider-pick" onClick={() => setMaker(HUGGING_FACE)} data-testid="setup-maker-hf">Hugging Face</button>
                  {IMAGE_SERVICES.map((sv) => (
                    <button key={sv.id} role="radio" aria-checked={!viaHf && service === sv.id} className="provider-pick" onClick={() => setMaker(sv.id)}>{MEDIA_PROVIDERS.image[sv.id].label}</button>
                  ))}
                </div>
                {viaHf ? (
                  <div className="setup-row"><Check size={14} className="ok-text" /> <span className="grow">Free with a Hugging Face account</span><small className="faint">Sign in at the end</small></div>
                ) : serviceKeySaved ? (
                  <div className="setup-row"><Check size={14} className="ok-text" /> <span className="grow">{cloud.saved && provider.key === serviceKey ? `Uses your ${MEDIA_PROVIDERS.image[service].label} key` : "Key saved"}</span></div>
                ) : (
                  <div className="setup-key">
                    <Field label={`${MEDIA_PROVIDERS.image[service].label} key`} type="password" value={makerKey.value} onChange={(v) => setMakerKey({ ...makerKey, value: v, error: "" })} placeholder="Paste your key" error={makerKey.error || null} testId="setup-maker-key"
                      note={<button className="link-btn" style={{ padding: 0 }} onClick={() => void openExternal(IMAGE_SERVICES.find((x) => x.id === service)!.keysUrl)}>Get your {MEDIA_PROVIDERS.image[service].label} key ↗</button>} />
                    <button className="btn" disabled={!makerKey.value.trim()} onClick={() => void saveMakerKey()} data-testid="setup-save-maker-key">Save</button>
                  </div>
                )}
              </section>
            )}
            <section className="setup-section">
              {needs.web && <div className="setup-row"><Globe size={15} className="faint" /><span className="grow">Web search</span><small className="faint">Exa · free, no key</small><Check size={14} className="ok-text" /></div>}
              <div className="setup-row"><FolderOpen size={15} className="faint" /><span className="grow">Shared files</span><small className="faint mono">{(health?.workspace ?? "~/McBot").replace(/[\\/]+$/, "")}/files</small><Check size={14} className="ok-text" /></div>
            </section>

          </>
        )}

        {step === "build" && (
          <>
            <h1>{result ? "Your team is ready" : failed ? "Something went wrong" : "Setting up"}</h1>
            <div className="setup-faces">
              {kept.flatMap((t) => t.members).map((m) => (
                <span key={m.name} data-tip={m.displayName}><AgentFace seed={m.name} size={46} status={result ? "succeeded" : "running"} /></span>
              ))}
            </div>
            <ul className="setup-checks">
              {rows.map((r) => (
                <li key={r.label} data-status={r.status}>
                  <span className="mark">{r.status === "busy" ? <LoaderCircle size={15} className="spin-icon" /> : r.status === "ok" ? <Check size={15} strokeWidth={3} /> : r.status === "wait" ? null : <TriangleAlert size={14} />}</span>
                  <span className="grow">{r.label}</span>
                  {(r.status === "busy" && r.label === "Preparing the engine" && prepLine ? prepLine : r.detail) && (
                    <small className="mono ellipsis" style={{ maxWidth: 260 }}>{r.status === "busy" && r.label === "Preparing the engine" && prepLine ? prepLine : r.detail}</small>
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
            <button className="btn ghost" onClick={() => go("tools")}><ArrowLeft size={14} /> Back</button>
          ) : <span />}
          <Dots index={index} />
          {step === "build" ? (
            <div className="row">
              {result && hfAgent.current && (
                <button className="btn lg" disabled={hfSigning === "busy"} data-testid="setup-hf-signin" onClick={() => {
                  setHfSigning("busy");
                  engine.signIn(hfAgent.current!, "hugging_face").then(() => setHfSigning("started")).catch(() => setHfSigning("failed"));
                }}>{hfSigning === "started" ? "Finish in your browser" : hfSigning === "failed" ? "Sign in from the board" : "Sign in to Hugging Face"}</button>
              )}
              <button className="btn primary lg" disabled={!result} onClick={() => result && onDone(result.boardId, result.agentNodeId)} data-testid="setup-finish">
                {result?.agentNodeId ? "Start chatting" : "Open McBot Studio"}
              </button>
            </div>
          ) : (
            <div className="row">
              {step === "brain" && <button className="btn ghost" onClick={() => void build([])} data-testid="setup-later">Later</button>}
              {step === "tools" && (needs.image || needs.video) && !serviceKeySaved && <button className="btn ghost" onClick={() => void build(models)} data-testid="setup-tools-later">Later</button>}
              <button className="btn primary lg" disabled={!canNext[step]} onClick={next} data-testid="setup-next">
                {step === "welcome" ? "Get started" : step === "tools" ? "Build my team" : "Continue"}
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
