/**
 * Right-click (or the row's "…") on a file, a folder or a whole place in Files: its actions in a glass
 * menu at the pointer, portalled to the page (the view animates with a transform). A click elsewhere
 * or Esc closes it (lib/presence.ts). Only what that place allows is offered (src/harness/live.ts).
 */
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDismiss } from "../lib/presence";

export interface MenuItem {
  icon: ReactNode;
  label: string;
  keys?: string;
  danger?: boolean;
  run: () => void;
}

/** Items in groups; empty groups vanish, and a divider sits between the rest. */
export function RowMenu({ x, y, groups, onClose }: { x: number; y: number; groups: (MenuItem | false | null | undefined)[][]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => onClose(), [onClose]);
  useDismiss(true, close, ref);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - el.offsetWidth - 8)), top: Math.max(8, Math.min(y, window.innerHeight - el.offsetHeight - 8)) });
    el.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [x, y]);
  const shown = groups.map((g) => g.filter((i): i is MenuItem => !!i)).filter((g) => g.length);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };
  return createPortal(
    <div ref={ref} className="menu context-menu" role="menu" style={pos} onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()} data-testid="files-menu">
      {shown.map((g, i) => (
        <div key={i} className="menu-group">
          {i > 0 && <div className="menu-sep" role="separator" />}
          {g.map((item) => (
            <button key={item.label} role="menuitem" className={item.danger ? "danger" : undefined} onClick={() => { close(); item.run(); }}>
              {item.icon}<span className="grow">{item.label}</span>{item.keys && <span className="menu-keys">{item.keys}</span>}
            </button>
          ))}
        </div>
      ))}
    </div>,
    document.body,
  );
}
