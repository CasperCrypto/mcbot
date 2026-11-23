import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { openShell, terminalsAvailable, type ShellSession } from "./terminal";
import { useApp } from "../state/store";

/** The terminal's colours, from tokens.css (xterm needs colours, not CSS variables). */
function termTheme() {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const accent = v("--accent", "#0a84ff");
  return { background: v("--bg-canvas", "#161618"), foreground: v("--text", "#f5f5f7"), cursor: accent, cursorAccent: v("--bg-canvas", "#161618"), selectionBackground: /^#[0-9a-f]{6}$/i.test(accent) ? `${accent}55` : "#0a84ff55" };
}

/** One real shell in `cwd` (the desktop app only). Closed when unmounted. */
export function TerminalPanel({ cwd }: { cwd: string }) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!terminalsAvailable() || !host.current) return;
    const style = getComputedStyle(document.documentElement);
    const term = new Terminal({
      fontFamily: style.getPropertyValue("--mono").trim() || "monospace",
      fontSize: 13.5,
      cursorBlink: true,
      allowProposedApi: false,
      theme: termTheme(),
    });
    terminal.current = term;
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
      terminal.current = null;
    };
  }, [cwd, run]);
  // A new accent: the open shell's cursor and selection follow it.
  const accent = useApp((s) => s.appearance.accent);
  useEffect(() => {
    if (terminal.current) terminal.current.options.theme = termTheme();
  }, [accent]);

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
