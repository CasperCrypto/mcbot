import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { openShell, terminalsAvailable, type ShellSession } from "./terminal";

/** One real shell in `cwd` (the desktop app only). Closed when unmounted. */
export function TerminalPanel({ cwd }: { cwd: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!terminalsAvailable() || !host.current) return;
    const style = getComputedStyle(document.documentElement);
    const term = new Terminal({
      fontFamily: style.getPropertyValue("--mono").trim() || "monospace",
      fontSize: 12.5,
      cursorBlink: true,
      allowProposedApi: false,
      theme: { background: style.getPropertyValue("--bg-canvas").trim() || "#161618", foreground: style.getPropertyValue("--text").trim() || "#f5f5f7", cursor: style.getPropertyValue("--accent").trim() || "#0a84ff", selectionBackground: "#0a84ff55" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    fit.fit();
    let shell: ShellSession | null = null;
    let alive = true;
    setEnded(false);
    setError(null);
    openShell(cwd, term.cols, term.rows, (bytes) => term.write(bytes), () => { if (alive) setEnded(true); })
      .then((s) => {
        if (!alive) return s.close();
        shell = s;
        term.focus();
      })
      .catch((err: unknown) => setError(String(err)));
    const input = term.onData((d) => shell?.write(d));
    const size = term.onResize(({ cols, rows }) => shell?.resize(cols, rows));
    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* hidden: nothing to fit */
      }
    });
    observer.observe(host.current);
    return () => {
      alive = false;
      observer.disconnect();
      input.dispose();
      size.dispose();
      shell?.close();
      term.dispose();
    };
  }, [cwd, run]);

  if (!terminalsAvailable()) return <div className="terminal-off faint">The terminal runs in the desktop app.</div>;
  return (
    <div className="terminal-wrap" data-testid="terminal">
      <div ref={host} className="terminal-host" />
      {(ended || error) && (
        <div className="terminal-ended">
          <span className="faint">{error ?? "The shell ended."}</span>
          <button className="btn sm" onClick={() => setRun((n) => n + 1)}>New shell</button>
        </div>
      )}
    </div>
  );
}
