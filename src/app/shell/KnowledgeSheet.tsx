/**
 * Team knowledge: what every agent knows about who it works for (the board's `brief`). Each field
 * goes into the shared board as it is typed, and every agent's SOUL.md gets it at the next compile
 * (src/compile/soul.ts, "Shared knowledge"), so a teammate's edit reaches everyone's agents too.
 */
import { BookOpen, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { setBriefField } from "../../board/ydoc";
import { BRIEF_MAX, emptyBrief, type Brief } from "../../contracts/graph";
import { compileBoard } from "../actions";
import { usePresence } from "../lib/presence";
import { useBoard } from "../state/board";
import { useApp } from "../state/store";

/** The brief's fields as the sheet and the setup assistant ask for them. */
export const BRIEF_FORM: { key: keyof Brief; label: string; placeholder: string; rows?: number }[] = [
  { key: "who", label: "Who the agents work for", placeholder: "Northwind Bakery, a family bakery in Leeds" },
  { key: "what", label: "What you do", placeholder: "Sourdough, pastries and cakes, baked every morning; a café and online orders", rows: 2 },
  { key: "offer", label: "Products and prices", placeholder: "Loaves from £4, celebration cakes from £35, weekly bread subscription", rows: 2 },
  { key: "customers", label: "Customers", placeholder: "Local families, office lunch orders, people planning a celebration", rows: 2 },
  { key: "goals", label: "Goals now", placeholder: "Sell out by noon every day · 500 newsletter subscribers by June · launch cake orders online", rows: 3 },
  { key: "voice", label: "Voice", placeholder: "Warm, local, a little playful; never pushy; British spelling" },
  { key: "channels", label: "Where you show up", placeholder: "Instagram, TikTok, newsletter, the shop window" },
  { key: "sales", label: "How you sell", placeholder: "Walk-ins and pre-orders; cakes by enquiry, then a quote by email", rows: 2 },
  { key: "links", label: "Links", placeholder: "northwindbakery.co.uk · instagram.com/northwindbakes" },
  { key: "notes", label: "Anything else they should know", placeholder: "Closed Mondays. No nuts in anything. Photos: natural light, no filters.", rows: 4 },
];


export function KnowledgeSheet() {
  const open = useApp((s) => s.knowledgeOpen);
  const setOpen = useApp((s) => s.setKnowledgeOpen);
  const { doc, graph, boardId } = useBoard();
  const brief = graph.brief ?? emptyBrief();
  // What is typed shows at once; the board gets it as it is typed (each field its own entry, so two
  // people editing two fields both keep theirs).
  const [draft, setDraft] = useState<Brief>(brief);
  const focused = useRef<keyof Brief | null>(null);
  useEffect(() => {
    // Someone else's edit arrives: take it, except in the field being typed in here.
    setDraft((d) => {
      const next = { ...brief };
      if (focused.current) next[focused.current] = d[focused.current];
      return next;
    });
  }, [JSON.stringify(brief)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  const presence = usePresence(open);
  if (!presence.mounted) return null;

  const set = (k: keyof Brief, v: string) => {
    const value = v.slice(0, BRIEF_MAX[k]);
    setDraft((d) => ({ ...d, [k]: value }));
    setBriefField(doc, k, value);
  };
  const filled = BRIEF_FORM.filter((f) => draft[f.key].trim()).length;
  const done = () => {
    setOpen(false);
    // The agents get it with their next compile; do it now so a chat right after already knows.
    void compileBoard(boardId, { quiet: true });
  };

  return (
    <>
      <div data-closing={presence.closing || undefined} className="palette-scrim" onClick={done} />
      <section className="palette hermes-sheet knowledge-sheet" role="dialog" aria-modal="true" data-closing={presence.closing || undefined} aria-label="Team knowledge" data-testid="knowledge-sheet">
        <header>
          <span className="hermes-mark" aria-hidden><BookOpen size={18} /></span>
          <div className="grow">
            <h2>Team knowledge</h2>
            <small>Every agent knows this · {filled} of {BRIEF_FORM.length}</small>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={done}><X size={15} /></button>
        </header>
        <div className="knowledge-body">
          {BRIEF_FORM.map((f) => (
            <label key={f.key} className="field">
              <span>{f.label}</span>
              {f.rows ? (
                <textarea rows={f.rows} value={draft[f.key]} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)}
                  onFocus={() => { focused.current = f.key; }} onBlur={() => { focused.current = null; }} data-testid={`brief-${f.key}`} />
              ) : (
                <input value={draft[f.key]} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)}
                  onFocus={() => { focused.current = f.key; }} onBlur={() => { focused.current = null; }} data-testid={`brief-${f.key}`} />
              )}
            </label>
          ))}
        </div>
        <footer className="knowledge-foot">
          <span className="faint grow">Goes into every agent's SOUL.md when you compile.</span>
          <button className="btn primary" onClick={done} data-testid="knowledge-done">Done</button>
        </footer>
      </section>
    </>
  );
}
