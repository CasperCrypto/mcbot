/**
 * The window's floating layers: pop-up menus (pickers, the board's context menu), sheets and ⌘K
 * (dialogs), side panels, and the island when it opens or grows (its notices too). A native page
 * (the Browser view's child webview on macOS and Windows) draws above all of them, so it steps aside
 * while any of them overlaps it (`useLayersOver`), wherever the layer comes from: nothing has to
 * register. Tooltips don't count; they come and go with the pointer.
 */
import { useEffect, useState, type RefObject } from "react";

export const LAYER_SELECTOR = ".menu, .palette, .palette-scrim, [role='dialog'], .island";

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Two boxes share some area (touching edges don't count; an empty box overlaps nothing). */
export const overlaps = (a: Box, b: Box): boolean =>
  a.right > a.left && a.bottom > a.top && b.right > b.left && b.bottom > b.top &&
  a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;

/** Whether any of `layers` lies over `area` (a layer inside the area is part of it, not over it). */
export function layersOver(area: { getBoundingClientRect(): Box; contains(other: unknown): boolean }, layers: Iterable<{ getBoundingClientRect(): Box }>): boolean {
  const box = area.getBoundingClientRect();
  for (const layer of layers) if (!area.contains(layer) && overlaps(layer.getBoundingClientRect(), box)) return true;
  return false;
}

/**
 * True while a floating layer covers the element: checked on every change to the page's elements, again
 * as a layer settles, and when a transition ends (the island grows and shrinks with a spring after its
 * class changes).
 */
export function useLayersOver(ref: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!enabled || typeof MutationObserver === "undefined") {
      setOver(false);
      return undefined;
    }
    let raf = 0;
    let settle: ReturnType<typeof setTimeout>[] = [];
    const check = () => {
      raf = 0;
      const area = ref.current;
      setOver(!!area && layersOver(area, document.querySelectorAll(LAYER_SELECTOR)));
    };
    const soon = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    const changed = () => {
      soon();
      settle.forEach(clearTimeout);
      settle = [setTimeout(soon, 140), setTimeout(soon, 420)];
    };
    const watch = new MutationObserver(changed);
    watch.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "open", "data-closing"] });
    window.addEventListener("resize", changed);
    // A layer that grows or shrinks with a transition (the island's spring) is checked again when it ends.
    document.addEventListener("transitionend", soon, true);
    document.addEventListener("animationend", soon, true);
    check();
    return () => {
      watch.disconnect();
      cancelAnimationFrame(raf);
      settle.forEach(clearTimeout);
      window.removeEventListener("resize", changed);
      document.removeEventListener("transitionend", soon, true);
      document.removeEventListener("animationend", soon, true);
    };
  }, [ref, enabled]);
  return over;
}
