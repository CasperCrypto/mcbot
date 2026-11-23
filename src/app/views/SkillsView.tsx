/**
 * Skills, per agent: what it knows how to do. Three layers, all Hermes':
 * its own skills (written on the board, compiled to skills/<name>/SKILL.md), Hermes' built-in
 * skills (seeded after a compile unless turned off), and the official library (installed into the
 * compiled agent with `hermes skills install`). Host only: members don't reach the library.
 */
import { BUNDLED } from "../../contracts/library.generated";
import { Check, Download, Eye, Globe, Hammer, Link2, Pencil, Plus, RefreshCw, Search, Sparkles, Trash2, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { setNodeField } from "../../board/ydoc";
import type { LibrarySkill, ProfileSkill, SkillSearchResult, SkillsView as SkillsState } from "../../contracts/api";
import type { AgentNode } from "../../contracts/graph";
import { readSkill } from "../../harness/read";
import { compileBoard } from "../actions";
import { engine } from "../lib/engine";
import { Sidebar } from "../shell/Sidebar";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { AgentFace, Empty, Segmented, SkeletonCards } from "../ui";
import { PluginsPanel } from "./PluginsPanel";
import { categoryName, prettyName } from "../lib/names";

/** A pasted link or identifier installs; plain words search. */
const looksLikeSource = (t: string) => /^https:\/\//.test(t.trim()) || /^[\w.-]+(\/[\w.@-]+){2,}$/.test(t.trim());

const ago = (iso: string) => {
  const d = Math.max(0, Date.now() - Date.parse(iso));
  if (!Number.isFinite(d)) return "";
  const m = Math.round(d / 60_000);
  return m < 60 ? `${m || 1} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export function SkillsView() {
  const { graph, doc, boardId } = useBoard();
  const app = useApp();
  const agents = useMemo(() => graph.nodes.filter((n): n is AgentNode => n.kind === "agent").sort((a, b) => a.data.name.localeCompare(b.data.name)), [graph]);
  const [current, setCurrent] = useState<string | null>(() => useApp.getState().selectedNodeId);
  const agent = agents.find((a) => a.id === current) ?? agents[0] ?? null;
  const [state, setState] = useState<SkillsState | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [showBundled, setShowBundled] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [reading, setReading] = useState<{ name: string; text: string } | null>(null);
  const [pane, setPane] = useState<"skills" | "plugins">("skills");
  const [found, setFound] = useState<SkillSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  const profile = agent?.data.name ?? "";
  useEffect(() => {
    let live = true;
    setState(null);
    setReading(null);
    if (profile) engine.skills(profile).then((v) => { if (live) setState(v); }).catch(() => { if (live) setState({ library: [], installed: [], seeded: false, compiled: false }); });
    return () => { live = false; };
  }, [profile]);

  if (!agent) return <section className="main flush-left"><Empty title="No agents yet" action={<button className="btn light" onClick={() => app.setTab("graph")}>Open graph</button>}>Agents' skills live here.</Empty></section>;

  const builtin = agent.data.builtinSkills !== false;
  const installed = new Set(state?.installed ?? []);
  const library = state?.library ?? [];
  const cats = [...new Set(library.map((s) => s.category))].sort((a, b) => categoryName(a).localeCompare(categoryName(b)));
  const words = looksLikeSource(q) ? "" : q.trim().toLowerCase();
  const shown = library.filter((s) => (!cat || s.category === cat) && (!words || `${s.name} ${prettyName(s.name)} ${categoryName(s.category)} ${s.description} ${s.tags.join(" ")}`.toLowerCase().includes(words)));
  const edit = () => { app.setTab("graph"); app.select(agent.id); };
  const install = async (s: LibrarySkill) => {
    setBusy(s.id);
    try {
      const r = await engine.installSkill(profile, s.id);
      setState((prev) => (prev ? { ...prev, installed: r.installed } : prev));
      app.toast({ kind: "ok", text: `${prettyName(s.name)} installed for ${agent.data.displayName || profile}` });
    } catch (e) {
      app.toast({ kind: "fail", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const onBoard = new Set(agent.data.skills.map((sk) => sk.name));
  // What the agent taught itself: written by it (or in Hermes), not by the board, the library or Hermes' seed.
  const learned = (state?.skills ?? []).filter((sk) => sk.origin === "learned" && !(sk.category === null && onBoard.has(sk.name)));
  const libraryOn = (state?.skills ?? []).filter((sk) => sk.origin === "library");
  const others = agents.filter((a) => a.id !== agent.id);
  const view = async (sk: ProfileSkill) => {
    if (reading?.name === sk.name) return setReading(null);
    try {
      const r = await engine.read(`profile:${profile}`, sk.path);
      setReading({ name: sk.name, text: r.text ?? r.reason ?? "" });
    } catch (e) {
      app.toast({ kind: "fail", text: (e as Error).message });
    }
  };
  /** Copy a learned skill onto every other agent's board skills (it compiles into each of them). */
  const share = async (sk: ProfileSkill) => {
    setBusy(sk.name);
    try {
      const r = await engine.read(`profile:${profile}`, sk.path);
      const parsed = r.text ? readSkill(r.text) : null;
      if (!parsed) throw new Error("This skill has a shape the board can't hold yet: open it in Code");
      let n = 0;
      for (const a of others) {
        if (a.data.skills.some((x) => x.name === parsed.name)) continue;
        setNodeField(doc, a.id, "skills", [...a.data.skills, parsed]);
        n++;
      }
      app.toast({ kind: "ok", text: n ? `${prettyName(parsed.name)} added to ${n} agent${n === 1 ? "" : "s"}. Compile to apply` : "Every agent has it already" });
    } catch (e) {
      app.toast({ kind: "fail", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const libraryAct = async (name: string, act: "update" | "remove") => {
    setBusy(name);
    try {
      const r = act === "update" ? await engine.updateSkill(profile, name) : await engine.uninstallSkill(profile, name);
      setState((prev) => (prev ? { ...prev, installed: r.installed, skills: r.skills } : prev));
      app.toast({ kind: "ok", text: `${prettyName(name)} ${act === "update" ? "is up to date" : "removed"}` });
    } catch (e) {
      app.toast({ kind: "fail", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  /** Enter in the search box: a link installs, words search every registry Hermes knows. */
  const go = async () => {
    const t = q.trim();
    if (!t) return;
    if (looksLikeSource(t)) return void addFrom(t, t);
    setSearching(true);
    try {
      setFound((await engine.searchSkills(t)).results);
    } catch (e) {
      app.toast({ kind: "fail", text: (e as Error).message });
    } finally {
      setSearching(false);
    }
  };
  const addFrom = async (source: string, key: string) => {
    setBusy(key);
    try {
      const r = await engine.addSkill(profile, source);
      setState((prev) => (prev ? { ...prev, installed: r.installed, skills: r.skills } : prev));
      app.toast({ kind: "ok", text: `Skill added to ${agent.data.displayName || profile}` });
      if (looksLikeSource(q)) setQ("");
    } catch (e) {
      app.toast({ kind: "fail", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const compile = () => void compileBoard(boardId).then((ok) => { if (ok) void engine.skills(profile).then(setState); });

  return (
    <>
      <Sidebar title="Skills">
        {agents.map((a) => (
          <button key={a.id} className="list-row" aria-selected={a.id === agent.id} onClick={() => setCurrent(a.id)}>
            <AgentFace seed={a.data.name} size={30} />
            <span className="grow" style={{ display: "grid" }}>
              <span className="title ellipsis">{a.data.displayName || a.data.name}</span>
              <span className="sub">{a.data.skills.length} own{a.data.builtinSkills !== false ? " · built-in on" : ""}</span>
            </span>
          </button>
        ))}
      </Sidebar>
      <section className="main" data-testid="skills-view">
        <div className="scroll-page">
          <div className="settings-page skills-page" key={agent.id}>
            <div className="row">
              <AgentFace seed={profile} size={40} />
              <div className="grow"><h2 style={{ margin: 0 }}>{agent.data.displayName || profile}</h2><span className="faint mono">@{profile}</span></div>
              {state && !state.compiled && <button className="btn primary" onClick={compile} data-tip="Installing needs the agent on disk"><Hammer size={13} /> Compile</button>}
            </div>
            <div style={{ maxWidth: 260 }} data-testid="skills-pane"><Segmented value={pane} onChange={setPane} options={[{ value: "skills", label: "Skills" }, { value: "plugins", label: "Plugins" }]} /></div>
            {pane === "plugins" ? <PluginsPanel profile={profile} label={agent.data.displayName || profile} compiled={!!state?.compiled} onCompile={compile} /> : <>
              <label className="catalog-search">
                {looksLikeSource(q) ? <Link2 size={14} /> : <Search size={14} />}
                <input value={q} onChange={(e) => { setQ(e.target.value); setFound(null); }} onKeyDown={(e) => { if (e.key === "Enter") void go(); }}
                  placeholder="Search skills, or paste a GitHub link" aria-label="Search skills, or paste a GitHub link" data-testid="skills-search" />
                {q.trim() && <button className="btn sm" disabled={busy !== null || searching || (looksLikeSource(q) && !state?.compiled)} onClick={() => void go()} data-testid="skills-go"
                  data-tip={looksLikeSource(q) ? (state?.compiled ? "Hermes checks it before it goes in" : "Compile first") : "Search skills.sh, GitHub, ClawHub and more"}>
                  {looksLikeSource(q) ? <><Download size={12} /> {busy === q.trim() ? "Adding…" : "Add"}</> : <><Globe size={12} /> {searching ? "Searching…" : "Search online"}</>}
                </button>}
              </label>
              {found && (
                <div className="stack" style={{ gap: 8 }} data-testid="skills-found">
                  <span className="section-label">Online · {found.length}</span>
                  {found.length === 0 ? <span className="faint">Nothing found. Try other words, or paste a link.</span> : (
                    <div className="catalog-grid">
                      {found.map((r) => (
                        <div key={r.identifier} className="catalog-card skill-card-lib">
                          <span className="grow" style={{ display: "grid", gap: 2, minWidth: 0 }}>
                            <span className="row" style={{ gap: 6, minWidth: 0 }}><b className="ellipsis">{prettyName(r.name)}</b><span className="chip" data-tip={r.identifier}>{r.source}</span></span>
                            <span className="faint">{r.description}</span>
                          </span>
                          {installed.has(r.name) ? <span className="chip ok"><Check size={11} /> On</span>
                            : <button className="btn sm" disabled={busy !== null || !state?.compiled} onClick={() => void addFrom(r.identifier, r.identifier)} data-tip={state?.compiled ? `${r.trust} · checked by Hermes before it goes in` : "Compile first"}>
                              <Download size={12} /> {busy === r.identifier ? "Adding…" : "Add"}
                            </button>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

            <div className="stack" style={{ gap: 8 }} data-testid="skills-learned">
              <div className="row"><span className="section-label grow"><Sparkles size={12} /> Taught itself{learned.length ? ` · ${learned.length}` : ""}</span></div>
              {!state ? <SkeletonCards count={2} /> : learned.length === 0 ? <span className="faint">{state.compiled ? "Nothing yet. Skills it writes during runs show up here." : "Compile, then run it: skills it writes show up here."}</span> : (
                <div className="catalog-grid">
                  {learned.map((sk) => (
                    <div key={sk.path} className="catalog-card skill-card-lib" data-testid={`learned-${sk.name}`}>
                      <span className="grow" style={{ display: "grid", gap: 2, minWidth: 0 }}>
                        <b className="ellipsis">{prettyName(sk.name)}</b>
                        <span className="faint">{sk.description}</span>
                        <span className="faint" style={{ fontSize: 12 }}>{ago(sk.modified)}</span>
                      </span>
                      <span className="row" style={{ gap: 4 }}>
                        <button className="btn ghost sm" aria-label="Read" data-tip="Read" onClick={() => void view(sk)}><Eye size={13} /></button>
                        {others.length > 0 && <button className="btn ghost sm" aria-label="Give to the team" data-tip="Give to every agent" disabled={busy !== null} onClick={() => void share(sk)}><Users size={13} /></button>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {reading && <pre className="mono skill-read" data-testid="skill-read">{reading.text}</pre>}
            </div>

            {(() => {
              const official = new Set(library.map((l) => l.name));
              const added = libraryOn.filter((x) => !official.has(x.name));
              if (!added.length) return null;
              return (
                <div className="stack" style={{ gap: 8 }} data-testid="skills-added">
                  <span className="section-label">Added · {added.length}</span>
                  <div className="catalog-grid">
                    {added.map((sk) => (
                      <div key={sk.path} className="catalog-card skill-card-lib">
                        <span className="grow" style={{ display: "grid", gap: 2, minWidth: 0 }}><b className="ellipsis">{prettyName(sk.name)}</b><span className="faint">{sk.description}</span></span>
                        <span className="row" style={{ gap: 4 }}>
                          <button className="btn ghost sm" aria-label="Read" data-tip="Read" onClick={() => void view(sk)}><Eye size={13} /></button>
                          <button className="btn ghost sm" aria-label={`Update ${sk.name}`} data-tip="Update" disabled={busy !== null} onClick={() => void libraryAct(sk.name, "update")}><RefreshCw size={12} /></button>
                          <button className="btn ghost sm" aria-label={`Remove ${sk.name}`} data-tip="Remove" disabled={busy !== null} onClick={() => void libraryAct(sk.name, "remove")}><Trash2 size={12} /></button>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            <div className="stack" style={{ gap: 8 }}>
              <div className="row"><span className="section-label grow">Its own</span><button className="btn ghost sm" onClick={edit}><Plus size={13} /> New</button></div>
              {agent.data.skills.length === 0 ? <span className="faint">None yet.</span> : (
                <div className="catalog-grid">
                  {agent.data.skills.map((s) => (
                    <button key={s.name} className="catalog-card" onClick={edit} data-tip="Edit on the board">
                      <span className="grow" style={{ display: "grid", gap: 2, minWidth: 0 }}><b className="ellipsis">{prettyName(s.name)}</b><span className="faint ellipsis">{s.description}</span></span>
                      <Pencil size={13} className="faint" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="row skill-builtin">
              <div className="grow" style={{ display: "grid", gap: 2 }}>
                <b>Hermes' built-in skills</b>
                <span className="faint">{builtin ? (state?.seeded ? `${BUNDLED.length} skills, on` : "On, added at the next compile") : "Off"}</span>
              </div>
              <button type="button" className="btn sm ghost" aria-expanded={showBundled} onClick={() => setShowBundled(!showBundled)} data-testid="skills-bundled-toggle">
                {showBundled ? "Hide" : "Show all"}</button>
              <button type="button" className="switch" role="switch" aria-checked={builtin} aria-label="Hermes' built-in skills" data-testid="skills-builtin"
                onClick={() => setNodeField(doc, agent.id, "builtinSkills", builtin ? false : null)}><span /></button>
            </div>
            {showBundled && (
              <div className="bundled-skills" data-testid="skills-bundled">
                {[...new Set(BUNDLED.map((s) => s.category))].map((c) => (
                  <div key={c} className="bundled-group">
                    <span className="suggest-label">{categoryName(c)}</span>
                    <div className="suggest-row">
                      {BUNDLED.filter((s) => s.category === c).map((s) => <span key={s.name} className="chip" data-tip={s.description}>{prettyName(s.name)}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="stack" style={{ gap: 10 }}>
              <div className="row">
                <span className="section-label grow">Library{library.length ? ` · ${library.length}` : ""}</span>
                {installed.size > 0 && <span className="chip">{installed.size} installed</span>}
              </div>
              {cats.length > 0 && (
                <div className="abilities">
                  <button type="button" className="ability" aria-pressed={!cat} onClick={() => setCat(null)}>All</button>
                  {cats.map((c) => <button key={c} type="button" className="ability" aria-pressed={cat === c} onClick={() => setCat(cat === c ? null : c)}>{categoryName(c)}</button>)}
                </div>
              )}
              {!state ? <SkeletonCards count={6} /> : shown.length === 0 ? <span className="faint">Nothing matches.</span> : (
                <div className="catalog-grid">
                  {shown.map((s) => {
                    const has = installed.has(s.name);
                    return (
                      <div key={s.id} className="catalog-card skill-card-lib" data-testid={`lib-${s.name}`}>
                        <span className="grow" style={{ display: "grid", gap: 2, minWidth: 0 }}>
                          <b className="ellipsis">{prettyName(s.name)}</b>
                          <span className="faint" data-tip={s.tags.join(", ") || undefined}>{s.description}</span>
                        </span>
                        {has ? <span className="row" style={{ gap: 4 }}>
                            <span className="chip ok" aria-label="Installed"><Check size={11} /> On</span>
                            {libraryOn.some((x) => x.name === s.name) && <>
                              <button className="btn ghost sm" aria-label={`Update ${s.name}`} data-tip="Update" disabled={busy !== null} onClick={() => void libraryAct(s.name, "update")}><RefreshCw size={12} /></button>
                              <button className="btn ghost sm" aria-label={`Remove ${s.name}`} data-tip="Remove" disabled={busy !== null} onClick={() => void libraryAct(s.name, "remove")}><Trash2 size={12} /></button>
                            </>}
                          </span>
                          : <button className="btn sm" disabled={busy !== null || !state.compiled} onClick={() => void install(s)} data-tip={state.compiled ? undefined : "Compile first"}>
                            <Download size={12} /> {busy === s.id ? "Installing…" : "Install"}
                          </button>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            </>}
          </div>
        </div>
      </section>
    </>
  );
}
