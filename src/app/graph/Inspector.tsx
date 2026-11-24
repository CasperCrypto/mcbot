import { Check, CheckCheck, Cloud, HardDrive, LoaderCircle, LogIn, Plug, Plus, RotateCcw, Send, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SignInView } from "../../contracts/api";
import { removeNodes, setNodeField } from "../../board/ydoc";
import type { Issue } from "../../compile";
import {
  AgentDataSchema, CAPABILITIES, ChannelDataSchema, PLATFORMS, channelKeyName, type Platform, DEFAULT_CAPABILITIES, MEDIA_PROVIDERS, MediaDataSchema, ModelDataSchema, ToolDataSchema,
  type AgentData, type Capability, type ChannelData, type GraphNode, type MediaData, type ModelData, type Skill, type ToolData,
} from "../../contracts/graph";
import { keyEnvFor } from "../lib/providers";
import { REMOTE, engine } from "../lib/engine";
import { useBoard } from "../state/board";
import { useDismiss } from "../lib/presence";
import { useApp } from "../state/store";
import { Field, Issues, Segmented, TextListField } from "../ui";
import { LogoTile, nodeLogo } from "./Logo";
import { MakerIcon } from "./nodes";
import { AgentPage } from "../agent/AgentPage";

type Errors = Record<string, string>;
export function fieldErrors(schema: { safeParse(v: unknown): { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } } }, data: unknown): Errors {
  const r = schema.safeParse(data);
  if (r.success || !r.error) return {};
  const out: Errors = {};
  for (const i of r.error.issues) out[i.path.map(String).join(".")] ??= i.message;
  return out;
}

export function Inspector({ node, issues, closing = false }: { node: GraphNode; issues: Issue[]; closing?: boolean }) {
  const { doc } = useBoard();
  const select = useApp((s) => s.select);
  const set = (field: string, value: unknown) => setNodeField(doc, node.id, field, value);
  // Esc puts it away (a click on the empty board already does).
  const panel = useRef<HTMLElement>(null);
  const deselect = useCallback(() => select(null), [select]);
  useDismiss(!closing, deselect, panel, { outside: false });
  // An agent: its whole page, one scroll (agent/AgentPage.tsx), the same one the Chat view shows.
  if (node.kind === "agent") return (
    <aside ref={panel} data-closing={closing || undefined} className="inspector glass agent-inspector" aria-label="Agent" data-testid="inspector">
      <AgentPage agent={node} where="board" onClose={() => select(null)} />
    </aside>
  );

  const title = node.data.label;
  const sub = node.kind === "model" ? (node.data.endpoint === "local" ? "Local model" : "Cloud model")
    : node.kind === "media" ? (node.data.media === "video" ? "Video maker" : "Image maker")
    : node.kind === "channel" ? "Chat app" : "MCP server";

  return (
    <aside ref={panel} data-closing={closing || undefined} className="inspector glass" aria-label="Inspector" data-testid="inspector">
      <div className="inspector-head">
        {node.kind === "media" ? <LogoTile logo={nodeLogo(node)} kind="media"><MakerIcon media={node.data.media} size={16} /></LogoTile>
          : node.kind === "channel" ? <LogoTile logo={nodeLogo(node)} kind="channel"><Send size={15} /></LogoTile>
          : <LogoTile logo={nodeLogo(node)} kind={node.kind === "tool" ? "tool" : node.data.endpoint === "local" ? "model" : "cloud"}>
            {node.kind === "tool" ? <Plug size={16} /> : node.data.endpoint === "local" ? <HardDrive size={16} /> : <Cloud size={16} />}
          </LogoTile>}
        <div className="title">
          <input value={title} placeholder={node.data.name || "Untitled"} onChange={(e) => set("label", e.target.value)} aria-label="Name" data-testid="inspector-title" />
          <small>{sub}</small>
        </div>
        <button className="icon-btn" data-tip="Delete" data-tip-side="bottom" aria-label="Delete" onClick={() => { removeNodes(doc, [node.id]); select(null); }}><Trash2 size={15} /></button>
        <button className="icon-btn" aria-label="Close" onClick={() => select(null)}><X size={16} /></button>
      </div>
      <div className="inspector-body">
        <Issues issues={issues} />
        {node.kind === "model" && <ModelFields data={node.data} set={set} />}
        {node.kind === "tool" && <ToolFields nodeId={node.id} data={node.data} set={set} />}
        {node.kind === "media" && <MakerFields data={node.data} set={set} />}
        {node.kind === "channel" && <ChannelFields data={node.data} set={set} />}
      </div>
    </aside>
  );
}

/**
 * The tool sets this agent may use. Untouched, it follows Hermes' default; the first
 * change pins a list (platform_toolsets.cli). A wired maker keeps its own tool set on.
 */
export function Abilities({ data, set, forced, title = "Abilities" }: { data: AgentData; set: (f: string, v: unknown) => void; forced: Set<Capability>; title?: string }) {
  const on = new Set<Capability>(data.capabilities ?? DEFAULT_CAPABILITIES);
  const toggle = (k: Capability) => {
    const next = new Set(on);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    set("capabilities", CAPABILITIES.map((c) => c.key).filter((c) => next.has(c)));
  };
  return (
    <div className="stack" data-testid="abilities">
      <div className="row">
        <span className="section-label grow">{title}</span>
        {on.size < CAPABILITIES.length && (
          <button className="icon-btn sm" aria-label="Turn all on" data-tip="Turn all on" data-tip-side="top" data-testid="abilities-all" onClick={() => set("capabilities", CAPABILITIES.map((c) => c.key))}><CheckCheck size={13} /></button>
        )}
        {data.capabilities != null && (
          <button className="icon-btn sm" aria-label="Back to defaults" data-tip="Back to defaults" data-tip-side="top" onClick={() => set("capabilities", null)}><RotateCcw size={12} /></button>
        )}
      </div>
      <div className="abilities">
        {CAPABILITIES.map((c) => {
          const locked = forced.has(c.key);
          const active = locked || on.has(c.key);
          return (
            <button key={c.key} type="button" className="ability" aria-pressed={active} disabled={locked} onClick={() => toggle(c.key)}
              data-tip={locked ? "On: a maker is connected" : undefined} data-tip-side="top" data-testid={`ability-${c.key}`}>
              {active && <Check size={11} strokeWidth={2.6} />}{c.label}
            </button>
          );
        })}
      </div>
      {on.has("browser") && <BrowserSettings data={data} set={set} />}
    </div>
  );
}

/** How its browser runs: Hermes' `browser.headed`, `browser.engine`, `browser.use_real_profile`. */
function BrowserSettings({ data, set }: { data: AgentData; set: (f: string, v: unknown) => void }) {
  const b = { show: false, engine: "chromium" as const, myLogins: false, ...(data.browser ?? {}) };
  const put = (patch: Partial<typeof b>) => {
    const next = { ...b, ...patch };
    set("browser", next.show || next.engine !== "chromium" || next.myLogins ? next : null);
  };
  const row = (label: string, tip: string, on: boolean, flip: () => void, id: string) => (
    <button type="button" className="ability" aria-pressed={on} onClick={flip} data-tip={tip} data-tip-side="top" data-testid={id}>{label}</button>
  );
  return (
    <div className="stack" style={{ gap: 6 }} data-testid="browser-settings">
      <span className="section-label">Browser</span>
      <div className="abilities">
        {row("Show its window", "Watch it browse, live, in its own Chromium window", b.show, () => put({ show: !b.show }), "browser-show")}
        {row("Fast engine", "Lightpanda: much faster, no screenshots. Install it first: lightpanda.io", b.engine === "lightpanda", () => put({ engine: b.engine === "lightpanda" ? "chromium" : "lightpanda" }), "browser-fast")}
        {row("Use my logins", "Browses with a copy of your own browser's logins", b.myLogins, () => put({ myLogins: !b.myLogins }), "browser-logins")}
      </div>
    </div>
  );
}

/**
 * A Telegram bot for one agent. The token comes from @BotFather; only the ids listed may talk to
 * it (Hermes refuses everyone else). It answers while this computer and McBot's gateway are on.
 */
function ChannelFields({ data, set }: { data: ChannelData; set: (f: string, v: unknown) => void }) {
  const errors = fieldErrors(ChannelDataSchema, data);
  const p: Platform = PLATFORMS[data.platform];
  const [ids, setIds] = useState(data.allowedUsers.join(", "));
  const userError = Object.entries(errors).find(([k]) => k.startsWith("allowedUsers"))?.[1];
  const telegram = data.platform === "telegram";
  return (
    <>
      {/* Secrets are saved in McBot under the bot's own names; plain settings sit on the board. */}
      {p.required.map((f) => f.secret
        ? <KeyField key={f.env} name={channelKeyName(data, f.env)} label={f.prompt} placeholder={f.url ? `From ${f.url.replace(/^https?:\/\//, "")}` : "Paste it here"} />
        : <Field key={f.env} label={f.prompt} value={data.settings[f.env] ?? ""} mono testId={`channel-${f.env}`}
            onChange={(v) => set("settings", { ...data.settings, [f.env]: v })} />)}
      {p.allowedUsersEnv && (
        <Field label="Allowed users" value={ids} mono placeholder={`Your ${p.label} user id`} testId="channel-users"
          error={userError ? "One id each, separated by commas" : telegram && data.allowedUsers.some((u) => !/^\d+$/.test(u)) ? "Numbers only, like 123456789" : null}
          onChange={(v) => { setIds(v); set("allowedUsers", v.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean)); }} />
      )}
      {telegram && <Field label="Bot API server" value={data.apiBase} onChange={(v) => set("apiBase", v.trim())} mono placeholder="api.telegram.org" error={errors.apiBase} />}
      <Field label="ID" value={data.name} onChange={(v) => set("name", v)} mono error={errors.name} />
    </>
  );
}

function MakerFields({ data, set }: { data: MediaData; set: (f: string, v: unknown) => void }) {
  const errors = fieldErrors(MediaDataSchema, data);
  const services = MEDIA_PROVIDERS[data.media] as Record<string, { label: string; keyEnv: string }>;
  const service = services[data.provider];
  return (
    <>
      <label className="field">
        <span>Service</span>
        <select value={service ? data.provider : ""} onChange={(e) => set("provider", e.target.value)} data-testid="maker-service">
          {!service && <option value="" disabled>Pick a service</option>}
          {Object.entries(services).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}
        </select>
      </label>
      {service && <KeyField name={service.keyEnv} />}
      <Field label="Model" value={data.model} onChange={(v) => set("model", v)} mono placeholder="Service default" />
      <Field label="ID" value={data.name} onChange={(v) => set("name", v)} mono error={errors.name} />
    </>
  );
}

export function Skills({ data, set }: { data: AgentData; set: (f: string, v: unknown) => void }) {
  const errors = fieldErrors(AgentDataSchema, data);
  const update = (i: number, patch: Partial<Skill>) => set("skills", data.skills.map((s, n) => (n === i ? { ...s, ...patch } : s)));
  const add = () => set("skills", [...data.skills, { name: `skill-${data.skills.length + 1}`, description: "What this skill does.", version: "1.0.0", author: "", license: "", platforms: [], tags: [], body: "" }]);
  return (
    <>
      {data.skills.map((s, i) => (
        <div key={i} className="skill-card">
          <div className="row">
            <div className="grow"><Field value={s.name} onChange={(v) => update(i, { name: v })} mono ariaLabel="Skill name" error={errors[`skills.${i}.name`]} /></div>
            <button className="icon-btn" aria-label="Remove skill" onClick={() => set("skills", data.skills.filter((_, n) => n !== i))}><Trash2 size={14} /></button>
          </div>
          <Field value={s.description} onChange={(v) => update(i, { description: v })} ariaLabel="Skill description" placeholder="One sentence, 60 characters max." error={errors[`skills.${i}.description`]} />
          <Field value={s.body} onChange={(v) => update(i, { body: v })} multiline rows={5} mono ariaLabel="Skill instructions" placeholder="Steps the agent follows." />
        </div>
      ))}
      <button className="btn" onClick={add}><Plus size={14} /> Add skill</button>
    </>
  );
}

function ModelFields({ data, set }: { data: ModelData; set: (f: string, v: unknown) => void }) {
  const errors = fieldErrors(ModelDataSchema, data);
  const price = data.pricing;
  const setPrice = (k: "inputPerMTok" | "outputPerMTok", v: string) => {
    const n = v.trim() === "" ? 0 : Number(v);
    const next = { inputPerMTok: price?.inputPerMTok ?? 0, outputPerMTok: price?.outputPerMTok ?? 0, [k]: Number.isFinite(n) ? n : 0 };
    set("pricing", next.inputPerMTok === 0 && next.outputPerMTok === 0 ? null : next);
  };
  return (
    <>
      <Segmented value={data.endpoint} onChange={(v) => set("endpoint", v)} options={[{ value: "local", label: "Local" }, { value: "cloud", label: "Cloud" }]} />
      <Field label="Endpoint" value={data.baseUrl} onChange={(v) => set("baseUrl", v)} mono error={errors.baseUrl} />
      <Field label="Model" value={data.model} onChange={(v) => set("model", v)} mono error={errors.model ? "Required" : null} />
      {data.endpoint === "cloud" && <KeyField name={data.apiKeyEnv || keyNameFor(data)} error={errors.apiKeyEnv} onSaved={(n) => { if (data.apiKeyEnv !== n) set("apiKeyEnv", n); }} />}
      <Field label="ID" value={data.name} onChange={(v) => set("name", v)} mono error={errors.name} />
      <div className="grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="$ / 1M in" type="number" value={price ? String(price.inputPerMTok) : ""} onChange={(v) => setPrice("inputPerMTok", v)} />
        <Field label="$ / 1M out" type="number" value={price ? String(price.outputPerMTok) : ""} onChange={(v) => setPrice("outputPerMTok", v)} />
      </div>
    </>
  );
}

/** The variable a cloud key is saved under: the usual one for known services, else one per model node. */
const keyNameFor = (d: ModelData) => keyEnvFor(d.baseUrl, d.name);

/**
 * A key, typed once and kept on this computer by the engine, never on the board: the
 * board only names its variable. Shared by cloud models and makers.
 */
function KeyField({ name, error, onSaved, label = "API key", placeholder = "Paste your key" }: { name: string; error?: string; onSaved?: (name: string) => void; label?: string; placeholder?: string }) {
  const [saved, setSaved] = useState<string[] | null>(null);
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    engine.secrets().then((r) => setSaved(r.names)).catch(() => setSaved([]));
  }, []);
  const has = !!saved?.includes(name);
  useEffect(() => {
    if (has) onSaved?.(name);
  }, [has, name]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    try {
      const r = await engine.setSecret(name, value);
      onSaved?.(name);
      setSaved(r.names);
      setValue("");
      setEditing(false);
      setProblem(null);
    } catch (err) {
      setProblem((err as Error).message);
    }
  };
  if (has && !editing) {
    return (
      <div className="field">
        <span>{label}</span>
        <div className="row key-saved" data-testid="api-key-saved">
          <Check size={14} className="ok-text" /><span className="grow" data-tip={`Saved as ${name}`} data-tip-side="top">Saved on this computer</span>
          <button className="btn ghost sm" onClick={() => setEditing(true)}>Change</button>
        </div>
      </div>
    );
  }
  return (
    <div className="key-entry">
      <Field label={label} type="password" value={value} onChange={(v) => { setValue(v); setProblem(null); }} placeholder={placeholder} error={problem ?? error ?? null} testId="api-key" />
      <button className="btn" disabled={!value.trim()} onClick={() => void save()} data-testid="api-key-save">Save</button>
    </div>
  );
}

const parsePairs = (text: string, sep: "=" | ":") =>
  Object.fromEntries(text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf(sep);
    return i < 0 ? [l, ""] : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }).filter(([k]) => k));

function ToolFields({ nodeId, data, set }: { nodeId: string; data: ToolData; set: (f: string, v: unknown) => void }) {
  const errors = fieldErrors(ToolDataSchema, data);
  const { graph } = useBoard();
  const agents = graph.edges.flatMap((e) => (e.source === nodeId ? [e.target] : e.target === nodeId ? [e.source] : []))
    .map((id) => graph.nodes.find((n) => n.id === id)).filter((n): n is Extract<GraphNode, { kind: "agent" }> => n?.kind === "agent");
  // How each agent's sign-in went: asked when the block opens, then every 2 s while one waits.
  const [signedIn, setSignedIn] = useState<Record<string, SignInView>>({});
  const oauth = data.auth === "oauth" && !REMOTE;
  const profiles = agents.map((a) => a.data.name).join(",");
  const waiting = Object.values(signedIn).some((s) => s.state === "waiting");
  useEffect(() => {
    if (!oauth || !profiles) return;
    let alive = true;
    const check = () => void Promise.all(profiles.split(",").map(async (p) => [p, await engine.signInState(p, data.name).catch(() => null)] as const))
      .then((all) => { if (alive) setSignedIn(Object.fromEntries(all.filter((e): e is readonly [string, SignInView] => !!e[1]))); });
    check();
    const t = waiting ? setInterval(check, 2000) : undefined;
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [oauth, profiles, data.name, waiting]);
  const signIn = async (profile: string) => {
    try {
      await engine.signIn(profile, data.name);
      setSignedIn((s) => ({ ...s, [profile]: { state: "waiting", error: null, at: Date.now() } }));
      useApp.getState().toast({ kind: "ok", text: "Finish signing in in your browser" });
    } catch (e) {
      useApp.getState().toast({ kind: "fail", text: e instanceof Error ? e.message : String(e) });
    }
  };
  // Keys it reads as ${env:NAME}: saved in McBot, written to the agent's .env before each run.
  const keys = [...new Set([...Object.values(data.env), ...Object.values(data.headers)].flatMap((v) => [...v.matchAll(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]!)))];
  return (
    <>
      {keys.map((k) => <KeyField key={k} name={k} label={keys.length > 1 ? k : "API key"} />)}
      <Segmented value={data.transport} onChange={(v) => set("transport", v)} options={[{ value: "stdio", label: "Local" }, { value: "http", label: "Remote" }]} />
      <Field label="Key" value={data.name} onChange={(v) => set("name", v)} mono error={errors.name} />
      {data.transport === "stdio" ? (
        <>
          <Field label="Command" value={data.command} onChange={(v) => set("command", v)} mono placeholder="npx" />
          <TextListField label="Arguments" value={data.args.join("\n")} onCommit={(t) => set("args", t.split("\n").map((s) => s.trim()).filter(Boolean))} rows={4} placeholder="One per line" />
          <TextListField label="Environment" value={Object.entries(data.env).map(([k, v]) => `${k}=${v}`).join("\n")} onCommit={(t) => set("env", parsePairs(t, "="))} rows={2} placeholder="KEY=value or KEY=${env:SECRET}" />
        </>
      ) : (
        <>
          <Field label="URL" value={data.url} onChange={(v) => set("url", v)} mono />
          {data.auth === "oauth" && !REMOTE && (
            <div className="stack" style={{ gap: 6 }} data-testid="tool-signin">
              <span className="section-label">Sign in</span>
              {agents.length === 0 ? <span className="faint">Connect it to an agent, then compile.</span>
                : agents.map((a) => {
                  const st = signedIn[a.data.name];
                  const who = agents.length > 1 ? ` for ${a.data.displayName || a.data.name}` : "";
                  return (
                    <div key={a.id} className="stack" style={{ gap: 4 }}>
                      <button className="btn" disabled={st?.state === "waiting"} onClick={() => void signIn(a.data.name)}
                        data-tip={st?.state === "done" ? "Sign in again" : "Opens your browser to sign in for this agent"} data-tip-side="top">
                        {st?.state === "waiting" ? <><LoaderCircle size={14} className="spin-icon" /> Waiting for your browser…</>
                          : st?.state === "done" ? <><Check size={14} /> Signed in{who}</>
                          : <><LogIn size={14} /> Sign in{who}</>}
                      </button>
                      {st?.state === "failed" && <span className="chip fail ellipsis" data-tip={st.error ?? undefined} data-testid="signin-failed">Didn't sign in: {st.error ?? "try again"}</span>}
                    </div>
                  );
                })}
            </div>
          )}
          <TextListField label="Headers" value={Object.entries(data.headers).map(([k, v]) => `${k}: ${v}`).join("\n")} onCommit={(t) => set("headers", parsePairs(t, ":"))} rows={2} placeholder="Authorization: Bearer ${env:TOKEN}" />
        </>
      )}
    </>
  );
}

