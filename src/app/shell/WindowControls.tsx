import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { onMaximized, ownFrame, windowAct } from "../lib/desktop";

/** Minimize, maximize and close, for the frameless window (Windows and Linux; macOS has its traffic lights). */
export function WindowControls() {
  const [max, setMax] = useState(false);
  useEffect(() => {
    let off: (() => void) | undefined;
    let live = true;
    void onMaximized(setMax).then((f) => { if (live) off = f; else f(); });
    return () => { live = false; off?.(); };
  }, []);
  if (!ownFrame()) return null;
  return (
    <div className="win-controls" role="group" aria-label="Window">
      <button type="button" aria-label="Minimize" onClick={() => void windowAct("min")}><Minus size={15} /></button>
      <button type="button" aria-label={max ? "Restore" : "Maximize"} onClick={() => void windowAct("max")}>{max ? <Copy size={13} /> : <Square size={12} />}</button>
      <button type="button" className="close" aria-label="Close" onClick={() => void windowAct("close")}><X size={16} /></button>
    </div>
  );
}

/**
 * A strip across the top of screens that have no title bar (setup, "Starting McBot…"): the window can
 * still be dragged everywhere, and closed or minimized where the system draws no frame.
 */
export function FrameStrip() {
  return (
    <div className="frame-strip" data-tauri-drag-region>
      <WindowControls />
    </div>
  );
}
