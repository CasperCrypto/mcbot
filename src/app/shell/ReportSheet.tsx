/** Report a problem: what McBot can say about itself, to copy into a GitHub issue. Nothing is sent. */
import { Check, Copy, LifeBuoy, X } from "lucide-react";
import { useEffect, useState } from "react";
import { engine } from "../lib/engine";
import { openExternal } from "../lib/open";
import { issueUrl } from "../lib/report";
import { useApp } from "../state/store";

export function ReportSheet() {
  const open = useApp((s) => s.reportOpen);
  const setOpen = useApp((s) => s.setReportOpen);
  const toast = useApp((s) => s.toast);
  const [text, setText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setText(null);
    setCopied(false);
    engine.diagnostics()
      .then((d) => { if (alive) setText(d.text); })
      .catch((err: Error) => { if (alive) setText(`Could not read the engine: ${err.message}\n`); });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  if (!open) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text ?? "");
      setCopied(true);
    } catch {
      toast({ kind: "fail", text: "Couldn't copy. Select the text and copy it." });
    }
  };
  return (
    <>
      <div className="palette-scrim" onClick={() => setOpen(false)} />
      <section className="palette hermes-sheet report-sheet" role="dialog" aria-label="Report a problem" data-testid="report-sheet">
        <header>
          <span className="hermes-mark" aria-hidden><LifeBuoy size={18} /></span>
          <div className="grow">
            <h2>Report a problem</h2>
            <small>Keys and your home folder are hidden. Nothing is sent.</small>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}><X size={15} /></button>
        </header>
        <textarea className="mono" readOnly value={text ?? "Reading…"} aria-label="Details" data-testid="report-text" spellCheck={false} />
        <footer>
          <button className="btn" disabled={!text} onClick={() => void copy()} data-testid="report-copy">
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
          </button>
          <button className="btn primary" disabled={!text} data-tip="Opens GitHub with the summary filled in" onClick={() => void openExternal(issueUrl(text ?? ""))} data-testid="report-issue">
            Open an issue
          </button>
        </footer>
      </section>
    </>
  );
}
