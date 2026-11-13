/**
 * Skills, per agent: what it knows how to do. Three layers, all Hermes':
 * its own skills (written on the board, compiled to skills/<name>/SKILL.md), Hermes' built-in
 * skills (seeded after a compile unless turned off), and the official library (installed into the
 * compiled agent with `hermes skills install`). Host only: members don't reach the library.
 */
import { Check, Download, Hammer, Pencil, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { setNodeField } from "../../board/ydoc";
import type { LibrarySkill, SkillsView as SkillsState } from "../../contracts/api";
import type { AgentNode } from "../../contracts/graph";
import { compileBoard } from "../actions";
import { engine } from "../lib/engine";
import { Sidebar } from "../shell/Sidebar";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { AgentFace, Empty } from "../ui";

const pretty = (s: string) => s.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());

export function SkillsView() {
  const { graph, doc, boardId } = useBoard();
  const app = useApp();
  const agents = useMemo(() => graph.nodes.filter((n): n is AgentNode => n.kind === "agent").sort((a, b) => a.data.name.localeCompare(b.data.name)), [graph]);
  const [current, setCurrent] = useState<string | null>(() => useApp.getState().selectedNodeId);
  const agent = agents.find((a) => a.id === current) ?? agents[0] ?? null;
  const [state, setState] = useState<SkillsState | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const profile = agent?.data.name ?? "";
  useEffect(() => {
    let live = true;
    setState(null);
    if (profile) engine.skills(profile).then((v) => { if (live) setState(v); }).catch(() => { if (live) setState({ library: [], installed: [], seeded: false, compiled: false }); });
    return () => { live = false; };
  }, [profile]);

  if (!agent) return <section className="main flush-left"><Empty title="No agents yet" action={<button className="btn light" onClick={() => app.setTab("graph")}>Open graph</button>}>Agents' skills live here.</Empty></section>;

  const builtin = agent.data.builtinSkills !== false;
  const installed = new Set(state?.installed ?? []);
  const library = state?.library ?? [];
  const cats = [...new Set(library.map((s) => s.category))].sort();
  const words = q.trim().toLowerCase();
  const shown = library.filter((s) => (!cat || s.category === cat) && (!words || `${s.name} ${s.category} ${s.description} ${s.tags.join(" ")}`.toLowerCase().includes(words)));
  const edit = () => { app.setTab("graph"); app.select(agent.id); };
  const install = async (s: LibrarySkill) => {
    setBusy(s.id);
    try {
      const r = await engine.installSkill(profile, s.id);
      setState((prev) => (prev ? { ...prev, installed: r.installed } : prev));
      app.toast({ kind: "ok", text: `${pretty(s.name)} installed for ${agent.data.displayName || profile}` });
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

            <div className="stack" style={{ gap: 8 }}>
              <div className="row"><span className="section-label grow">Its own</span><button className="btn ghost sm" onClick={edit}><Plus size={13} /> New</button></div>
              {agent.data.skills.length === 0 ? <span className="faint">None yet.</span> : (
                <div className="catalog-grid">
                  {agent.data.skills.map((s) => (
                    <button key={s.name} className="catalog-card" onClick={edit} data-tip="Edit on the board">
                      <span className="grow" style={{ display: "grid", gap: 2, minWidth: 0 }}><b className="ellipsis">{pretty(s.name)}</b><span className="faint ellipsis">{s.description}</span></span>
                      <Pencil size={13} className="faint" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="row skill-builtin">
              <div className="grow" style={{ display: "grid", gap: 2 }}>
                <b>Hermes' built-in skills</b>
                <span className="faint">{builtin ? (state?.seeded ? "44 skills, on" : "On, added at the next compile") : "Off"}</span>
              </div>
              <button type="button" className="switch" role="switch" aria-checked={builtin} aria-label="Hermes' built-in skills" data-testid="skills-builtin"
                onClick={() => setNodeField(doc, agent.id, "builtinSkills", builtin ? false : null)}><span /></button>
            </div>

            <div className="stack" style={{ gap: 10 }}>
              <div className="row">
                <span className="section-label grow">Library{library.length ? ` · ${library.length}` : ""}</span>
                {installed.size > 0 && <span className="chip">{installed.size} installed</span>}
              </div>
              <label className="catalog-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search skills" aria-label="Search skills" data-testid="skills-search" /></label>
              {cats.length > 0 && (
                <div className="abilities">
                  <button type="button" className="ability" aria-pressed={!cat} onClick={() => setCat(null)}>All</button>
                  {cats.map((c) => <button key={c} type="button" className="ability" aria-pressed={cat === c} onClick={() => setCat(cat === c ? null : c)}>{pretty(c)}</button>)}
                </div>
              )}
              {!state ? <span className="faint">Loading…</span> : shown.length === 0 ? <span className="faint">Nothing matches.</span> : (
                <div className="catalog-grid">
                  {shown.map((s) => {
                    const has = installed.has(s.name);
                    return (
                      <div key={s.id} className="catalog-card skill-card-lib" data-testid={`lib-${s.name}`}>
                        <span className="grow" style={{ display: "grid", gap: 2, minWidth: 0 }}>
                          <b className="ellipsis">{pretty(s.name)}</b>
                          <span className="faint" data-tip={s.tags.join(", ") || undefined}>{s.description}</span>
                        </span>
                        {has ? <span className="chip ok" aria-label="Installed"><Check size={11} /> On</span>
                          : <button className="btn sm" disabled={busy !== null || !state.compiled} onClick={() => void install(s)} data-tip={state.compiled ? undefined : "Compile first"}>
                            <Download size={12} /> {busy === s.id ? "Installing…" : "Install"}
                          </button>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
