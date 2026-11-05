/** About McBot: version and the licence notices MIT asks every copy to carry (McBot, Hermes, libraries). */
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import mcbotLicense from "../../../LICENSE?raw";
import hermesLicense from "../../../hermes/LICENSE?raw";
import pkg from "../../../package.json";
import { BrandMark } from "./TitleBar";
import { useApp } from "../state/store";

function Notices() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    fetch("./third-party-notices.txt").then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status))))).then(setText).catch(() => setText(""));
  }, []);
  if (text === null) return <p className="faint">Loading…</p>;
  return text ? <pre className="license" data-testid="third-party-notices">{text}</pre> : <p className="faint">The list ships with built copies of McBot.</p>;
}

export function AboutSheet() {
  const open = useApp((s) => s.aboutOpen);
  const setOpen = useApp((s) => s.setAboutOpen);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  if (!open) return null;
  return (
    <>
      <div className="palette-scrim" onClick={() => setOpen(false)} />
      <section className="palette about-sheet" role="dialog" aria-label="About McBot" data-testid="about-sheet">
        <header>
          <BrandMark size={26} />
          <div className="grow">
            <h2>McBot</h2>
            <small>Version {pkg.version} · free and open source (MIT)</small>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}><X size={15} /></button>
        </header>
        <div className="about-body">
          <p>Built on <a href="https://github.com/NousResearch/hermes-agent" target="_blank" rel="noreferrer">Hermes Agent</a> by Nous Research. Not affiliated with Nous Research.</p>
          <details open>
            <summary>McBot licence</summary>
            <pre className="license">{mcbotLicense.trim()}</pre>
          </details>
          <details>
            <summary>Hermes Agent licence</summary>
            <pre className="license">{hermesLicense.trim()}</pre>
          </details>
          <details>
            <summary>Open-source libraries</summary>
            <Notices />
          </details>
        </div>
      </section>
    </>
  );
}
