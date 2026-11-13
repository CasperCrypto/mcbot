/**
 * Settings: the models agents think with (local servers and cloud providers, all OpenAI-compatible),
 * the keys McBot keeps on this computer, who you are on shared boards, your team, the engine.
 * Models are blocks on the board (so they compile); adding one here places it and wires it to the
 * agents picked. Keys never leave this computer: the board only names them.
 */
import { Check, Cloud, Cpu, ExternalLink, HardDrive, Info, KeyRound, LifeBuoy, LoaderCircle, Plus, RefreshCw, RotateCw, Sparkles, Trash2, User, Users, Waypoints } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { addEdge, addNode, removeNodes, updateEdge } from "../../board/ydoc";
import type { HermesInfo, LocalServer, SharingView } from "../../contracts/api";
import type { Graph, GraphNode, ModelNode } from "../../contracts/graph";
import { compileBoard } from "../actions";
import { newId, uniqueName } from "../graph/defaults";
import { freeSpot } from "../graph/place";
import { DEMO, engine, REMOTE } from "../lib/engine";
import { PEER_COLORS, nameChosen } from "../lib/identity";
import { agentsOf, attachModel, chainOf, modelsOf, promoteModel, usersOf, type ModelHealth } from "../lib/models";
import { useModelHealth } from "../lib/useModelHealth";
import { openExternal } from "../lib/open";
import { CLOUD_PROVIDERS, LOCAL_PRESETS, keyEnvFor, modelSlug, providerOf } from "../lib/providers";
import { Sidebar } from "../shell/Sidebar";
import { useBoard } from "../state/board";
import { useApp, type SettingsSection } from "../state/store";
import { AgentFace, Field, PersonFace, Segmented } from "../ui";

const SECTIONS: { id: SettingsSection; label: string; icon: ReactNode; host?: boolean }[] = [
  { id: "models", label: "Models", icon: <Sparkles size={14} /> },
  { id: "keys", label: "API keys", icon: <KeyRound size={14} />, host: true },
  { id: "you", label: "You", icon: <User size={14} /> },
  { id: "team", label: "Team", icon: <Users size={14} /> },
  { id: "engine", label: "Engine", icon: <Cpu size={14} />, host: true },
  { id: "about", label: "About", icon: <Info size={14} /> },
];

function useSecrets() {
  const [names, setNames] = useState<string[] | null>(null);
  useEffect(() => {
    engine.secrets().then((r) => setNames(r.names)).catch(() => setNames([]));
  }, []);
  return [names, setNames] as const;
}

function Card({ title, sub, action, children, testId }: { title: string; sub?: ReactNode; action?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="card settings-card" data-testid={testId}>
      <div className="settings-card-head">
        <div className="grow"><h2>{title}</h2>{sub && <small className="faint">{sub}</small>}</div>
        {action}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------- models

const hostOf = (baseUrl: string) => {
  try {
    return new URL(baseUrl).host;
  } catch {
    return "Local server";
  }
};
const providerLabel = (baseUrl: string) => LOCAL_PRESETS.find((p) => p.baseUrl === baseUrl)?.label ?? "the model server";

function ModelRow({ m, graph, saved, health, onRemove, onPromote }: { m: ModelNode; graph: Graph; saved: string[] | null; health?: ModelHealth; onRemove: () => void; onPromote: () => void }) {
  const users = usersOf(graph, m.id);
  const keyName = m.data.apiKeyEnv;
  const missingKey = m.data.endpoint === "cloud" && !!saved && !!keyName && !saved.includes(keyName);
  const main = users.filter((a) => chainOf(graph, a.id)[0]?.source === m.id).length;
  const app = useApp.getState();
  return (
    <div className="settings-row" data-testid="settings-model">
      <span className={`tile sm ${m.data.endpoint === "cloud" ? "cloud" : "model"}`}>{m.data.endpoint === "cloud" ? <Cloud size={14} /> : <HardDrive size={14} />}</span>
      <span className="grow" style={{ display: "grid", gap: 1, minWidth: 0 }}>
        <span className="title ellipsis">{m.data.label || m.data.name} <span className="mono faint" style={{ fontWeight: 400 }}>{m.data.model || "no model set"}</span></span>
        <span className="sub ellipsis">
          {users.length === 0 ? "No agent uses it" : `${main ? `Main for ${main}` : ""}${main && users.length - main ? " · " : ""}${users.length - main ? `Backup for ${users.length - main}` : ""}`}
          {" · "}{providerOf(m.data.baseUrl)?.label ?? m.data.baseUrl}
        </span>
      </span>
      {users.length > 0 && <span className="settings-faces">{users.slice(0, 4).map((a) => <AgentFace key={a.id} seed={a.data.name} size={20} />)}</span>}
      {health === "down" ? <span className="chip fail" data-tip={`Nothing answers at ${m.data.baseUrl}. Start ${providerLabel(m.data.baseUrl)}.`}>Not running</span>
        : health === "missing" ? <span className="chip warn" data-tip={`The server is up but doesn't have ${m.data.model}. Pull it, or pick a model it has.`}>Model missing</span>
        : health === "ok" ? <span className="chip ok"><Check size={11} /> Running</span> : null}
      {missingKey ? <button className="chip fail" onClick={() => app.openSettings("keys")} data-tip={`Save ${keyName}`}>No key</button>
        : m.data.endpoint === "cloud" && keyName && saved?.includes(keyName) ? <span className="chip ok" data-tip={`Saved as ${keyName}`}><Check size={11} /> Key</span> : null}
      {users.length > main && !REMOTE && <button className="btn sm ghost" onClick={onPromote} data-tip="Use it first for every agent that has it">Make main</button>}
      <button className="icon-btn sm" aria-label="Show on the board" data-tip="Show on the board" onClick={() => { app.select(m.id); app.setTab("graph"); }}><Waypoints size={13} /></button>
      {!REMOTE && <button className="icon-btn sm" aria-label="Remove" data-tip="Remove from the board" onClick={onRemove}><Trash2 size={13} /></button>}
    </div>
  );
}

function AddModel({ saved, setSaved, onDone }: { saved: string[] | null; setSaved: (n: string[]) => void; onDone: () => void }) {
  const { graph, doc, boardId } = useBoard();
  const toast = useApp((s) => s.toast);
  const agents = agentsOf(graph);
  const [where, setWhere] = useState<"local" | "cloud">("local");
  // local
  const [found, setFound] = useState<LocalServer[] | null>(null);
  const [custom, setCustom] = useState("");
  const [customModels, setCustomModels] = useState<{ baseUrl: string; models: string[] } | null | "none">(null);
  const [local, setLocal] = useState<{ label: string; baseUrl: string; model: string } | null>(null);
  // cloud
  const [providerId, setProviderId] = useState(CLOUD_PROVIDERS[0]!.id);
  const [otherUrl, setOtherUrl] = useState("");
  const [key, setKey] = useState("");
  const [keyProblem, setKeyProblem] = useState<string | null>(null);
  const [changingKey, setChangingKey] = useState(false);
  const [cloudModel, setCloudModel] = useState(CLOUD_PROVIDERS[0]!.model);
  const [cloudModels, setCloudModels] = useState<string[] | null>(null);
  // who gets it
  const noModel = agents.filter((a) => chainOf(graph, a.id).length === 0).map((a) => a.id);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(noModel.length ? noModel : agents.map((a) => a.id)));
  // A model added here is usually the one to use now; "Backup" keeps the current one first.
  const [main, setMain] = useState(true);
  const [busy, setBusy] = useState(false);

  const provider = CLOUD_PROVIDERS.find((p) => p.id === providerId);
  const cloudBase = provider ? provider.baseUrl : otherUrl.trim();
  const keyName = provider ? provider.keyEnv : keyEnvFor(cloudBase, "cloud");
  const hasKey = !!saved?.includes(keyName);

  const scan = async () => {
    setFound(null);
    const d = await engine.setupDetect().catch(() => null);
    const list = d?.local ?? [];
    setFound(list);
    if (!local && list[0]?.models[0]) setLocal({ label: list[0].name, baseUrl: list[0].baseUrl, model: list[0].models[0] });
  };
  useEffect(() => {
    if (!REMOTE) void scan();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const check = async () => {
    const url = custom.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//.test(url)) return setCustomModels("none");
    const base = /\/v1$/.test(url) ? url : `${url}/v1`;
    const { models } = await engine.setupModels(base).catch(() => ({ models: null }));
    setCustomModels(models?.length ? { baseUrl: base, models } : "none");
    if (models?.[0]) setLocal({ label: hostOf(base), baseUrl: base, model: models[0] });
  };

  // A saved key lets McBot ask the provider which models it has.
  useEffect(() => {
    setCloudModels(null);
    if (where !== "cloud" || !hasKey || !/^https?:\/\//.test(cloudBase)) return;
    let alive = true;
    void engine.setupModels(cloudBase, keyName).then((r) => { if (alive) setCloudModels(r.models); }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [where, hasKey, cloudBase, keyName]);

  const saveKey = async () => {
    try {
      const r = await engine.setSecret(keyName, key);
      setSaved(r.names);
      setKey("");
      setKeyProblem(null);
      setChangingKey(false);
    } catch (err) {
      setKeyProblem((err as Error).message);
    }
  };

  const ready = where === "local" ? !!local?.model.trim() : hasKey && !!cloudModel.trim() && /^https?:\/\//.test(cloudBase);
  const add = async () => {
    if (!ready || busy) return;
    setBusy(true);
    const taken = modelsOf(graph).map((m) => m.data.name);
    const label = where === "local" ? local!.label : provider?.label ?? "Cloud";
    const name = uniqueName(modelSlug(where === "local" ? local!.label : provider?.id ?? "cloud"), taken);
    const node: GraphNode = {
      id: newId("model"), kind: "model", position: freeSpot(graph, "model", null, null),
      data: where === "local"
        ? { name, label, endpoint: "local", baseUrl: local!.baseUrl, model: local!.model.trim(), apiKeyEnv: "", pricing: null }
        : { name, label, endpoint: "cloud", baseUrl: cloudBase, model: cloudModel.trim(), apiKeyEnv: keyName, pricing: null },
    };
    const withNode = { ...graph, nodes: [...graph.nodes, node] };
    const { add: edges, reorder } = attachModel(withNode, node.id, [...picked], main, () => newId("edge"));
    doc.transact(() => {
      addNode(doc, node);
      for (const e of edges) addEdge(doc, e);
      for (const r of reorder) updateEdge(doc, r.id, { order: r.order });
    });
    setBusy(false);
    toast({ kind: "ok", text: `${label} added${edges.length ? ` for ${edges.length} agent${edges.length > 1 ? "s" : ""}` : ""}`, action: { label: "Compile", run: () => void compileBoard(boardId) } });
    onDone();
  };

  return (
    <div className="stack add-model" style={{ gap: 14 }} data-testid="add-model">
      <Segmented value={where} onChange={setWhere} options={[{ value: "local", label: "On this computer" }, { value: "cloud", label: "Cloud provider" }]} />
      {where === "local" ? (
        <>
          <div className="settings-sub">
            <span className="grow">Found on this computer</span>
            {!REMOTE && <button className="icon-btn sm" aria-label="Look again" data-tip="Look again" onClick={() => void scan()}><RefreshCw size={12} /></button>}
          </div>
          {REMOTE ? <span className="faint">Local models run on the computer sharing these boards.</span>
            : found === null ? <span className="faint row"><LoaderCircle size={13} className="spin-icon" /> Looking for {LOCAL_PRESETS.map((p) => p.label).join(", ")}…</span>
            : found.length === 0 ? (
              <div className="row faint" style={{ gap: 8, flexWrap: "wrap" }}>
                <span className="grow">No model server is running.</span>
                <button className="btn sm" onClick={() => void openExternal("https://ollama.com/download")}><ExternalLink size={12} /> Get Ollama</button>
                <button className="btn sm" onClick={() => void openExternal("https://lmstudio.ai")}><ExternalLink size={12} /> Get LM Studio</button>
              </div>
            ) : (
              <div className="setup-models" role="radiogroup" aria-label="Local models">
                {found.flatMap((s) => s.models.map((m) => {
                  const on = local?.baseUrl === s.baseUrl && local.model === m;
                  return (
                    <button key={`${s.baseUrl}/${m}`} role="radio" aria-checked={on} className="model-pick" onClick={() => setLocal({ label: s.name, baseUrl: s.baseUrl, model: m })} data-testid="settings-local-model">
                      <span className="dot-radio" /><span className="mono grow">{m}</span><small>{s.name}</small>
                    </button>
                  );
                }))}
              </div>
            )}
          <div className="settings-sub"><span className="grow">Another address</span></div>
          <div className="key-entry">
            <Field value={custom} onChange={(v) => { setCustom(v); setCustomModels(null); }} placeholder="http://192.168.1.30:11434/v1" mono ariaLabel="Server address"
              error={customModels === "none" ? "No OpenAI-compatible server answered there" : null} />
            <button className="btn" disabled={!custom.trim()} onClick={() => void check()}>Check</button>
          </div>
          {customModels && customModels !== "none" && (
            <div className="setup-models" role="radiogroup" aria-label="Models at that address">
              {customModels.models.map((m) => {
                const on = local?.baseUrl === customModels.baseUrl && local.model === m;
                return (
                  <button key={m} role="radio" aria-checked={on} className="model-pick" onClick={() => setLocal({ label: hostOf(customModels.baseUrl), baseUrl: customModels.baseUrl, model: m })}>
                    <span className="dot-radio" /><span className="mono grow">{m}</span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="provider-grid" role="radiogroup" aria-label="Provider">
            {[...CLOUD_PROVIDERS, { id: "other", label: "Other…" }].map((p) => (
              <button key={p.id} role="radio" aria-checked={providerId === p.id} className="provider-pick" data-testid={`provider-${p.id}`}
                onClick={() => { setProviderId(p.id); setCloudModel((CLOUD_PROVIDERS.find((x) => x.id === p.id)?.model) ?? ""); setChangingKey(false); setKeyProblem(null); }}>
                {p.label}
                {"keyEnv" in p && saved?.includes(p.keyEnv) && <Check size={11} className="ok-text" />}
              </button>
            ))}
          </div>
          {!provider && <Field label="Address" value={otherUrl} onChange={setOtherUrl} placeholder="https://api.example.com/v1" mono note="Any OpenAI-compatible API" />}
          {hasKey && !changingKey ? (
            <div className="field"><span>API key</span>
              <div className="row key-saved"><Check size={14} className="ok-text" /><span className="grow" data-tip={`Saved as ${keyName}`}>Saved on this computer</span>
                {!REMOTE && <button className="btn ghost sm" onClick={() => setChangingKey(true)}>Change</button>}</div>
            </div>
          ) : REMOTE ? (
            <span className="faint">Keys are added on the computer sharing these boards.</span>
          ) : (
            <div className="key-entry">
              <Field label="API key" type="password" value={key} onChange={(v) => { setKey(v); setKeyProblem(null); }} placeholder="Paste your key" error={keyProblem} testId="settings-key"
                note={provider ? <button className="link-btn" style={{ padding: 0 }} onClick={() => void openExternal(provider.keysUrl)}>Get a {provider.label} key ↗</button> : undefined} />
              <button className="btn" disabled={!key.trim() || (!provider && !/^https?:\/\//.test(cloudBase))} onClick={() => void saveKey()} data-testid="settings-key-save">Save</button>
            </div>
          )}
          <label className="field">
            <span>Model</span>
            <input className="mono" list="settings-cloud-models" value={cloudModel} onChange={(e) => setCloudModel(e.target.value)} placeholder={cloudModels ? "Pick or type a model" : "Model name from your provider"} data-testid="settings-cloud-model" />
            <datalist id="settings-cloud-models">{(cloudModels ?? []).slice(0, 400).map((m) => <option key={m} value={m} />)}</datalist>
            {cloudModels && <span className="note">{cloudModels.length} models available</span>}
          </label>
        </>
      )}

      {agents.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="settings-sub"><span className="grow">Agents that use it</span>
            <button className="link-btn" onClick={() => setPicked(new Set(picked.size === agents.length ? [] : agents.map((a) => a.id)))}>{picked.size === agents.length ? "None" : "All"}</button>
          </div>
          <div className="settings-agents">
            {agents.map((a) => {
              const on = picked.has(a.id);
              const has = chainOf(graph, a.id).length;
              return (
                <button key={a.id} className="agent-chip" aria-pressed={on} onClick={() => { const n = new Set(picked); if (on) n.delete(a.id); else n.add(a.id); setPicked(n); }}>
                  <AgentFace seed={a.data.name} size={18} /><span>{a.data.displayName || a.data.name}</span>
                  {!has && <span className="dot warn" data-tip="No model yet" />}
                </button>
              );
            })}
          </div>
          <Segmented value={main ? "main" : "backup"} onChange={(v) => setMain(v === "main")} options={[{ value: "main", label: "Main model" }, { value: "backup", label: "Backup when the main one fails" }]} />
        </div>
      )}
      <div className="row"><span className="grow" /><button className="btn" onClick={onDone}>Cancel</button>
        <button className="btn primary" disabled={!ready || busy} onClick={() => void add()} data-testid="settings-add-model"><Plus size={13} /> Add model</button></div>
    </div>
  );
}

function ModelsSection() {
  const { graph, doc } = useBoard();
  const [saved, setSaved] = useSecrets();
  const models = modelsOf(graph);
  const agents = agentsOf(graph);
  const without = agents.filter((a) => chainOf(graph, a.id).length === 0);
  const [adding, setAdding] = useState(models.length === 0);
  const health = useModelHealth(models);
  return (
    <>
      <Card title="Models" sub="What your agents think with. Local ones are free and private; cloud ones need a key."
        action={!adding && <button className="btn sm primary" onClick={() => setAdding(true)} data-testid="settings-model-new"><Plus size={13} /> Add model</button>} testId="settings-models">
        {without.length > 0 && (
          <div className="settings-warn" data-testid="settings-no-model">
            <span className="dot warn" /><span className="grow">{without.map((a) => a.data.displayName || a.data.name).join(", ")} {without.length > 1 ? "have" : "has"} no model and can't run yet.</span>
            {!adding && <button className="btn sm" onClick={() => setAdding(true)}>Add one</button>}
          </div>
        )}
        {models.length === 0 && !adding && <div className="faint" style={{ padding: "4px 2px" }}>No models on this board yet.</div>}
        {models.map((m) => <ModelRow key={m.id} m={m} graph={graph} saved={saved} health={health[m.id]} onRemove={() => removeNodes(doc, [m.id])}
          onPromote={() => doc.transact(() => promoteModel(graph, m.id).forEach((r) => updateEdge(doc, r.id, { order: r.order })))} />)}
      </Card>
      {adding && (
        <Card title="Add a model" testId="settings-add">
          <AddModel saved={saved} setSaved={setSaved} onDone={() => setAdding(false)} />
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------- keys

function KeysSection() {
  const { graph } = useBoard();
  const [saved, setSaved] = useSecrets();
  const toast = useApp((s) => s.toast);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [newValue, setNewValue] = useState("");
  const [replacing, setReplacing] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Which board blocks name each key.
  const usedBy = useMemo(() => {
    const out = new Map<string, string[]>();
    const note = (k: string, who: string) => out.set(k, [...(out.get(k) ?? []), who]);
    for (const n of graph.nodes) {
      if (n.kind === "model" && n.data.apiKeyEnv) note(n.data.apiKeyEnv, n.data.label || n.data.name);
      if (n.kind === "tool") for (const v of [...Object.values(n.data.env ?? {}), ...Object.values(n.data.headers ?? {})]) for (const m of String(v).matchAll(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g)) note(m[1]!, n.data.label || n.data.name);
    }
    return out;
  }, [graph]);
  const missing = [...usedBy.keys()].filter((k) => saved && !saved.includes(k));
  const save = async (keyName: string, v: string) => {
    try {
      setSaved((await engine.setSecret(keyName, v)).names);
      setValue("");
      setNewValue("");
      setName("");
      setReplacing(null);
      setProblem(null);
      toast({ kind: "ok", text: `${keyName} saved` });
    } catch (err) {
      setProblem((err as Error).message);
    }
  };
  const remove = async (keyName: string) => {
    try {
      setSaved((await engine.removeSecret(keyName)).names);
    } catch (err) {
      toast({ kind: "fail", text: (err as Error).message });
    }
  };
  return (
    <Card title="API keys" sub="Kept on this computer only. Boards and teammates only ever see the name." testId="settings-keys">
      {[...missing.map((k) => ({ k, missing: true })), ...(saved ?? []).map((k) => ({ k, missing: false }))].map(({ k, missing: miss }) => (
        <div key={k} className="settings-row" data-testid="settings-key-row">
          <span className="tile sm file"><KeyRound size={13} /></span>
          <span className="grow" style={{ display: "grid", gap: 1, minWidth: 0 }}>
            <span className="title mono ellipsis">{k}</span>
            <span className="sub ellipsis">{miss ? "Needed, not saved yet" : "Saved"}{usedBy.get(k) ? ` · used by ${usedBy.get(k)!.join(", ")}` : ""}</span>
          </span>
          {replacing === k ? (
            <div className="key-entry" style={{ width: 300 }}>
              <Field type="password" value={value} onChange={(v) => { setValue(v); setProblem(null); }} placeholder="Paste the key" error={problem} ariaLabel={`Value of ${k}`} />
              <button className="btn sm primary" disabled={!value.trim()} onClick={() => void save(k, value)}>Save</button>
              <button className="btn sm ghost" onClick={() => { setReplacing(null); setValue(""); }}>Cancel</button>
            </div>
          ) : (
            <>
              <button className={`btn sm${miss ? " primary" : ""}`} onClick={() => { setReplacing(k); setValue(""); setProblem(null); }}>{miss ? "Add" : "Replace"}</button>
              {!miss && <button className="icon-btn sm" aria-label={`Remove ${k}`} data-tip="Remove" onClick={() => void remove(k)}><Trash2 size={13} /></button>}
            </>
          )}
        </div>
      ))}
      {saved?.length === 0 && missing.length === 0 && <div className="faint" style={{ padding: "4px 2px" }}>No keys yet. Adding a cloud model asks for one.</div>}
      <div className="settings-sub" style={{ marginTop: 6 }}><span className="grow">Another key</span></div>
      <div className="key-entry">
        <Field value={name} onChange={(v) => setName(v.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))} placeholder="NAME_OF_KEY" mono ariaLabel="Key name" />
        <Field type="password" value={newValue} onChange={setNewValue} placeholder="Value" ariaLabel="Key value" />
        <button className="btn" disabled={!name.trim() || !newValue.trim()} onClick={() => void save(name, newValue)}>Save</button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- you, team, engine, about

function YouSection() {
  const identity = useApp((s) => s.identity);
  const setIdentity = useApp((s) => s.setIdentity);
  const chosen = nameChosen(identity);
  const [name, setName] = useState(chosen ? identity.name : "");
  return (
    <Card title="You" sub="How teammates see you on shared boards and in team chat." testId="settings-you">
      <div className="row" style={{ gap: 14, alignItems: "flex-end" }}>
        <PersonFace name={name || identity.name} color={identity.color} size={44} />
        <div className="grow"><Field label="Your name" value={name} onChange={setName} placeholder={identity.name} testId="settings-name" /></div>
        <button className="btn primary" disabled={!name.trim() || (chosen && name.trim() === identity.name)} onClick={() => setIdentity({ ...identity, name: name.trim().slice(0, 64), chosen: true })}>Save</button>
      </div>
      <div className="field" style={{ marginTop: 12 }}><span>Colour</span>
        <div className="row" style={{ gap: 8 }}>
          {PEER_COLORS.map((c) => (
            <button key={c} className="swatch" aria-pressed={identity.color === c} aria-label={c} style={{ background: c }} onClick={() => setIdentity({ ...identity, color: c })} />
          ))}
        </div>
      </div>
    </Card>
  );
}

function TeamSection() {
  const app = useApp.getState();
  const [view, setView] = useState<SharingView | null>(null);
  useEffect(() => {
    if (!REMOTE && !DEMO) engine.share().then(setView).catch(() => undefined);
  }, []);
  return (
    <Card title="Team" sub={REMOTE ? `You're on ${REMOTE.label}'s boards.` : "Teammates on your network work on these boards with you, live."} testId="settings-team">
      {!REMOTE && (
        <div className="settings-row">
          <span className="grow">{view?.on ? `Sharing · ${view.members.length} ${view.members.length === 1 ? "person" : "people"} joined` : "Not sharing"}</span>
          <button className="btn sm primary" onClick={() => app.setShareOpen(true)}>Invite people</button>
        </div>
      )}
      <div className="settings-row">
        <span className="grow">{REMOTE ? "Go back to your own boards" : "Someone sent you a link?"}</span>
        <button className="btn sm" onClick={() => app.setShareOpen(true)}>{REMOTE ? "Leave" : "Join someone else's"}</button>
      </div>
    </Card>
  );
}

function EngineSection() {
  const [info, setInfo] = useState<HermesInfo | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => engine.hermes().then((i) => { if (alive) setInfo(i); }).catch(() => undefined);
    void load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  const ready = !!info?.kind;
  return (
    <Card title="Engine" sub="Hermes runs your agents. It comes with McBot." testId="settings-engine">
      <div className="settings-row">
        <span className={`dot ${ready ? "ok" : "warn"}`} />
        <span className="grow">{!info ? "…" : ready ? (info.kind === "bundled" ? "Ready · built into McBot" : "Ready · installed separately") : info.setup.state === "running" ? (info.setup.lines.at(-1) ?? "Preparing…") : "Needs preparing once (a few minutes)"}</span>
        {info && !ready && info.source && info.setup.state !== "running" && <button className="btn sm primary" onClick={async () => setInfo(await engine.prepareHermes().catch(() => info))}>Prepare</button>}
        {info?.setup.state === "running" && <LoaderCircle size={14} className="spin-icon" />}
      </div>
      {info && (
        <div className="settings-row">
          <span className={`dot ${info.gateway.running ? "ok" : ""}`} />
          <span className="grow">Gateway {info.gateway.running ? "running" : "starts with the next run"}</span>
          {info.managedRoot && info.gateway.running && <button className="btn sm" disabled={busy} onClick={async () => { setBusy(true); setInfo(await engine.restartGateway().catch(() => info)); setBusy(false); }}>{busy ? <LoaderCircle size={12} className="spin-icon" /> : <RotateCw size={12} />} Restart</button>}
        </div>
      )}
      {info && <div className="settings-row"><span className="faint grow">Agents live in</span><span className="mono ellipsis faint" style={{ fontSize: 12, maxWidth: 380 }} data-tip={info.root}>{info.root}</span></div>}
    </Card>
  );
}

function AboutSection() {
  const app = useApp.getState();
  const health = useApp((s) => s.health);
  return (
    <>
      <Card title="Start over" sub="Answer a few questions and get a ready team on a new board." testId="settings-setup">
        <div className="settings-row"><span className="grow">Your boards stay as they are.</span>
          <button className="btn sm primary" onClick={() => app.setSetup({ completed: false, profile: app.setup?.profile ?? null })} data-testid="settings-rerun-setup"><Sparkles size={12} /> Run setup again</button></div>
      </Card>
      <Card title="About McBot" sub={`Version ${health?.version ?? "…"} · free and open source (MIT)`}>
        <div className="settings-row"><span className="grow">Something not working?</span>
          <button className="btn sm" onClick={() => app.setReportOpen(true)}><LifeBuoy size={12} /> Report a problem</button>
          <button className="btn sm ghost" onClick={() => void openExternal("https://github.com/CasperCrypto/mcbot")}><ExternalLink size={12} /> GitHub</button></div>
      </Card>
    </>
  );
}

export function SettingsView() {
  const section = useApp((s) => s.settingsSection);
  const openSettings = useApp((s) => s.openSettings);
  const shown = SECTIONS.filter((s) => !(REMOTE && s.host));
  const current = shown.some((s) => s.id === section) ? section : "models";
  return (
    <>
      <Sidebar title="Settings" testId="settings-sidebar">
        {shown.map((s) => (
          <button key={s.id} className="list-row" aria-selected={current === s.id} onClick={() => openSettings(s.id)} data-testid={`settings-${s.id}-tab`}>
            <span className="faint" style={{ display: "grid" }}>{s.icon}</span><span className="grow">{s.label}</span>
          </button>
        ))}
      </Sidebar>
      <section className="main">
        <div className="scroll-page">
          <div className="settings-page" key={current}>
            {current === "models" && <ModelsSection />}
            {current === "keys" && <KeysSection />}
            {current === "you" && <YouSection />}
            {current === "team" && <TeamSection />}
            {current === "engine" && <EngineSection />}
            {current === "about" && <AboutSection />}
          </div>
        </div>
      </section>
    </>
  );
}
