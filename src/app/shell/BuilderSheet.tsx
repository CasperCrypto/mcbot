/**
 * Ask McBot: describe the team you need; McBot proposes a harness (agents, their tools, chat
 * apps, skills, loop, and hand-offs), you review it, and "Add to board" places it (one ⌘Z takes it
 * back). The board's own model plans it when it can (engine/builder.ts); otherwise the plan is made
 * here from the words (graph/builder.ts). Nothing changes until the person accepts.
 */
import { ArrowLeft, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { addEdge, addNode } from "../../board/ydoc";
import type { ModelNode } from "../../contracts/graph";
import { PLATFORMS } from "../../contracts/platforms.generated";
import type { HarnessPlan } from "../../harness/plan";
import { compileBoard, learnTeamSkills, skillName } from "../actions";
import { PLAN_CHOICES, planToBoard, quickPlan } from "../graph/builder";
import { CATALOG, CONNECTOR_TOOLS } from "../graph/catalog";
import { newModel } from "../graph/defaults";
import { engine, REMOTE } from "../lib/engine";
import { usePresence } from "../lib/presence";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";
import { AgentFace, SkeletonCards } from "../ui";

const EXAMPLES = [
  "A support team that answers customers on Slack from our docs",
  "A content team: research topics, write posts, make images",
  "A dev team that reviews our GitHub pull requests",
  "A personal assistant for my email, calendar and errands",
];

const toolLabel = (id: string) => [...CATALOG, ...CONNECTOR_TOOLS].find((t) => t.id === id)?.label ?? id;
const appLabel = (id: string) => (PLATFORMS as Record<string, { label: string }>)[id]?.label ?? id;

export function BuilderSheet() {
  const builder = useApp((s) => s.builder);
  const setBuilder = useApp((s) => s.setBuilder);
  const { doc, graph, boardId } = useBoard();
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<HarnessPlan | null>(null);
  const [by, setBy] = useState("");
  const asked = useRef(0);
  const close = () => setBuilder(false);

  useEffect(() => {
    if (!builder.open) return;
    setRequest(builder.request);
    setPlan(null);
    setBusy(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setBuilder(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [builder.open]); // eslint-disable-line react-hooks/exhaustive-deps

  const models = useMemo(() => graph.nodes.filter((n): n is ModelNode => n.kind === "model"), [graph]);
  const presence = usePresence(builder.open);
  if (!presence.mounted) return null;

  const design = async (words = request) => {
    const text = words.trim();
    if (text.length < 3 || busy) return;
    setRequest(text);
    setBusy(true);
    const mine = ++asked.current;
    let result: { plan: HarnessPlan; by: string };
    try {
      // The board's own model plans it; a teammate's window, the demo, or a model that can't, plan here.
      if (REMOTE || models.length === 0) throw new Error("no model");
      result = await engine.builderPlan(boardId, text, PLAN_CHOICES);
    } catch {
      result = { plan: quickPlan(text), by: "" };
    }
    if (mine !== asked.current) return;
    setPlan(result.plan);
    setBy(result.by);
    setBusy(false);
  };

  const accept = async () => {
    if (!plan) return;
    const model = models.find((m) => m.data.endpoint === "local") ?? models[0] ?? null;
    const { nodes, edges, lead, skills } = planToBoard(plan, graph, model, (p) => newModel(graph, "local", p));
    // One transaction: one ⌘Z takes the whole proposal back (board/undo.ts).
    doc.transact(() => {
      for (const n of nodes) addNode(doc, n);
      for (const e of edges) addEdge(doc, e);
    });
    close();
    const app = useApp.getState();
    app.setTab("graph");
    app.select(lead);
    app.requestFit();
    const count = plan.agents.length;
    app.toast({ kind: "ok", text: `Added ${count} agent${count === 1 ? "" : "s"} · ⌘Z takes it back` });
    if (await compileBoard(boardId, { quiet: true }) && !REMOTE && skills.length) void learnTeamSkills(count === 1 ? plan.agents[0]!.name : "The new team", skills);
  };

  const team = (name: string) => plan?.handoffs.filter(([f]) => f === name).map(([, t]) => t) ?? [];

  return (
    <>
      <div data-closing={presence.closing || undefined} className="palette-scrim" onClick={() => { if (!busy && !request.trim()) close(); }} />
      <section className="palette hermes-sheet builder" role="dialog" aria-modal="true" data-closing={presence.closing || undefined} aria-label="Ask McBot" data-testid="builder">
        <header>
          <span className="hermes-mark" aria-hidden><Sparkles size={18} /></span>
          <div className="grow">
            <h2>{plan ? "Here's a harness" : "Ask McBot to build it"}</h2>
            <small>{plan ? (by ? `Designed by ${by}` : "Quick plan") + " · nothing changes until you add it" : "Describe the agents you need"}</small>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={close}><X size={15} /></button>
        </header>

        {!plan ? (
          <div className="builder-body">
            <textarea autoFocus rows={3} value={request} onChange={(e) => setRequest(e.target.value)} data-testid="builder-request"
              placeholder="A team that researches our market every week, writes a short report and posts it to Slack"
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) { e.preventDefault(); void design(); } }} />
            {busy ? <SkeletonCards count={3} /> : (
              <div className="rich-choices">
                {EXAMPLES.map((x) => <button key={x} className="rich-choice" onClick={() => void design(x)}>{x}</button>)}
              </div>
            )}
          </div>
        ) : (
          <div className="builder-body" data-testid="builder-plan">
            {plan.summary && <p className="builder-summary">{plan.summary}</p>}
            <div className="builder-agents">
              {plan.agents.map((a) => (
                <div key={a.name} className="builder-agent" data-testid="builder-agent">
                  <div className="row" style={{ gap: 10 }}>
                    <AgentFace seed={a.name.toLowerCase()} size={30} />
                    <div className="grow" style={{ minWidth: 0 }}><b>{a.name}</b><div className="faint ellipsis">{a.about}</div></div>
                  </div>
                  <div className="builder-layers">
                    {team(a.name).length > 0 && <span className="chip" data-tip="Loop: hands work to">→ {team(a.name).join(", ")}</span>}
                    {a.tools.map((t) => <span key={t} className="chip" data-tip="Tool">{toolLabel(t)}</span>)}
                    {a.chatApps.map((c) => <span key={c} className="chip" data-tip="Chat app">{appLabel(c)}</span>)}
                    {a.skills.length > 0 && <span className="chip" data-tip={a.skills.map(skillName).join(", ")}>{a.skills.length} Hermes skill{a.skills.length === 1 ? "" : "s"}</span>}
                    {a.maxSteps ? <span className="chip" data-tip="Loop: steps per message">≤ {a.maxSteps} steps</span> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <footer className="new-agent-foot">
          {plan ? <button className="btn ghost sm" onClick={() => setPlan(null)} data-testid="builder-back"><ArrowLeft size={13} /> Change it</button>
            : <button className="btn ghost sm" onClick={() => { close(); useApp.getState().setTeamsOpen(true); }}>Or pick a starter team</button>}
          <span className="grow" />
          <button className="btn" onClick={close}>Cancel</button>
          {plan ? <button className="btn primary" onClick={() => void accept()} data-testid="builder-add">Add to board</button>
            : <button className="btn primary" disabled={request.trim().length < 3 || busy} onClick={() => void design()} data-testid="builder-design">{busy ? "Designing…" : "Design it"}</button>}
        </footer>
      </section>
    </>
  );
}
