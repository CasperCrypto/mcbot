/**
 * Popups leave the way they came: a sheet, panel or palette stays mounted for EXIT_MS after it is
 * closed, marked `data-closing`, so CSS can play its exit (glass.css "Leaving"). Reduced motion
 * removes it at once.
 */
import { useEffect, useState, type RefObject } from "react";

export const EXIT_MS = 200;

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function usePresence(open: boolean, ms = EXIT_MS): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return undefined;
    }
    const t = setTimeout(() => setMounted(false), reduced() ? 0 : ms);
    return () => clearTimeout(t);
  }, [open, ms]);
  return { mounted: open || mounted, closing: !open && mounted };
}

/**
 * Light dismiss, as on iOS and macOS: a click anywhere outside a popup, or Esc, closes it.
 * Esc closes only the popup opened last. Clicks on another floating layer (⌘K, a sheet, a toast,
 * a tooltip, a menu) or on anything marked `data-dismiss-ignore` (the button that toggles the
 * popup) leave it open.
 */
const stack: symbol[] = [];
const LAYERS = ".palette, .palette-scrim, .island, .tip, .menu, [data-dismiss-ignore], [role='dialog'][aria-modal='true']";

export function useDismiss(open: boolean, close: () => void, ref: RefObject<HTMLElement | null>, opts: { outside?: boolean } = {}): void {
  const outside = opts.outside !== false;
  useEffect(() => {
    if (!open) return undefined;
    const me = Symbol("popup");
    stack.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || stack[stack.length - 1] !== me) return;
      const t = e.target as HTMLElement | null;
      // Esc while typing first leaves the field, as on a Mac; the next Esc closes.
      if (t?.closest(".monaco-editor, .xterm")) return;
      if (t?.matches("input, textarea, select, [contenteditable='true']")) {
        t.blur();
        e.stopPropagation();
        return;
      }
      e.stopPropagation();
      close();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || !t.isConnected || ref.current?.contains(t)) return;
      if (t.closest(LAYERS)) return;
      close();
    };
    window.addEventListener("keydown", onKey, true);
    if (outside) document.addEventListener("pointerdown", onDown, true);
    return () => {
      stack.splice(stack.indexOf(me), 1);
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [open, close, ref, outside]);
}
