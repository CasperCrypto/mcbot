/** The Hermes McBot runs agents with: which one, what version, its gateway. */
import { Check, Copy, LoaderCircle, RotateCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { HermesInfo } from "../../contracts/api";
import { engine } from "../lib/engine";
import { useApp } from "../state/store";

const shortDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

export function HermesSheet() {
  const open = useApp((s) => s.hermesOpen);
  const setOpen = useApp((s) => s.setHermesOpen);
  const [info, setInfo] = useState<HermesInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = () => engine.hermes().then((i) => { if (alive) setInfo(i); }).catch(() => undefined);
    void load();
    const t = setInterval(load, 3000);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  if (!open) return null;
  const bundled = info?.kind === "bundled";
  const cli = !info ? "" : bundled ? "npm run hermes -- -p <agent>" : `HERMES_HOME=${info.root} hermes -p <agent>`;
  return (
    <>
      <div className="palette-scrim" onClick={() => setOpen(false)} />
      <section className="palette hermes-sheet" role="dialog" aria-label="Hermes" data-testid="hermes-sheet">
        <header>
          <span className="hermes-mark" aria-hidden>☤</span>
          <div className="grow">
            <h2>Hermes</h2>
            <small>{!info ? "…" : bundled ? "Built into McBot" : info.kind === "external" ? "Installed separately" : info.source ? "Built into McBot · not prepared yet" : "Not found"}</small>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}><X size={15} /></button>
        </header>
        {info && !info.kind && info.source && (
          <div className="hermes-prepare">
            {info.setup.state === "running" ? (
              <><LoaderCircle size={14} className="spin-icon" /><span className="mono ellipsis grow">{info.setup.lines.at(-1) ?? "Starting…"}</span></>
            ) : (
              <>
                <span className="grow">{info.setup.state === "failed" ? "Preparing failed. Check your connection and try again." : "Hermes needs its tools once (a few minutes)."}</span>
                <button className="btn primary sm" data-testid="hermes-prepare" onClick={async () => setInfo(await engine.prepareHermes().catch(() => info))}>Prepare</button>
              </>
            )}
          </div>
        )}
        {info && (
          <dl>
            {info.upstream && (
              <div><dt>Version</dt><dd><a className="mono" href={`${info.upstream.url.replace(/\.git$/, "")}/commit/${info.upstream.commit}`} target="_blank" rel="noreferrer">{info.upstream.commit.slice(0, 7)}</a> · {shortDate(info.upstream.date)}</dd></div>
            )}
            {!bundled && info.path && <div><dt>Program</dt><dd className="mono ellipsis">{info.path}</dd></div>}
            <div><dt>Agents' home</dt><dd className="mono ellipsis" data-tip={info.root} data-tip-side="top">{info.root}</dd></div>
            <div>
              <dt>Gateway</dt>
              <dd className="row">
                <span className={`dot ${info.gateway.running ? "ok" : ""}`} />
                <span className="grow">{info.gateway.running ? `Running${info.gateway.pid ? ` · pid ${info.gateway.pid}` : ""}` : "Starts with the next run"}</span>
                {info.managedRoot && info.gateway.running && (
                  <button className="btn sm" disabled={busy} data-testid="hermes-restart" onClick={async () => {
                    setBusy(true);
                    setInfo(await engine.restartGateway().catch(() => info));
                    setBusy(false);
                  }}>{busy ? <LoaderCircle size={13} className="spin-icon" /> : <RotateCw size={13} />} Restart</button>
                )}
              </dd>
            </div>
            <div><dt>Updates</dt><dd>{bundled ? "Arrive with McBot" : "Outside McBot"}</dd></div>
            <div>
              <dt>Terminal</dt>
              <dd className="row">
                <code className="mono grow ellipsis">{cli}</code>
                <button className="icon-btn sm" aria-label="Copy" data-tip={copied ? "Copied" : "Copy"} onClick={() => {
                  void navigator.clipboard?.writeText(cli).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }).catch(() => undefined);
                }}>{copied ? <Check size={12} /> : <Copy size={12} />}</button>
              </dd>
            </div>
          </dl>
        )}
      </section>
    </>
  );
}
