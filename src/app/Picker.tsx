/**
 * McBot's pop-up button: what a <select> does, drawn as the app's glass menu. A native <select>
 * opens the system's own list, which on Windows and Linux is a plain grey box. ↑ ↓ Home End move,
 * Enter or Space chooses, Esc closes, typing jumps to the option that starts with it. The menu is
 * portalled to the page (sheets and scrolling panels never clip it) and closes on scroll.
 */
import { Check, ChevronsUpDown } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDismiss } from "./lib/presence";

export interface PickerOption<T extends string = string> {
  value: T;
  label: string;
  /** A quieter second line: what an agent is for, where a model runs. */
  sub?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

/** Only one picker is open at a time. */
let closeOpen: (() => void) | null = null;

export function Picker<T extends string>({ value, options, onChange, label, placeholder = "Choose", icon, className, disabled, sm, testId, tip }: {
  value: T | "";
  options: readonly PickerOption<T>[];
  onChange: (value: T) => void;
  /** What it picks, for screen readers ("Agent"). */
  label: string;
  placeholder?: string;
  /** Drawn before the label instead of the chosen option's own icon. */
  icon?: ReactNode;
  className?: string;
  disabled?: boolean;
  sm?: boolean;
  testId?: string;
  tip?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<CSSProperties>({ visibility: "hidden" });
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const id = useId();
  const chosen = options.find((o) => o.value === value);

  const close = useCallback(() => {
    // Closed from the keyboard: the keyboard goes back to the button.
    if (menu.current?.contains(document.activeElement)) button.current?.focus();
    setOpen(false);
  }, []);
  useDismiss(open, close, menu);

  useEffect(() => {
    if (!open) return undefined;
    closeOpen?.();
    closeOpen = close;
    const i = options.findIndex((o) => o.value === value);
    setActive(i >= 0 ? i : options.findIndex((o) => !o.disabled));
    menu.current?.focus({ preventScroll: true });
    // A fixed menu would float away from its button: scrolling the page or resizing closes it.
    const onScroll = (e: Event) => { if (!menu.current?.contains(e.target as Node)) close(); };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      if (closeOpen === close) closeOpen = null;
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Under the button, or above it when there is no room below; never off screen.
  useLayoutEffect(() => {
    if (!open || !button.current || !menu.current) return;
    const b = button.current.getBoundingClientRect();
    const m = menu.current;
    const h = m.offsetHeight;
    const w = Math.max(m.offsetWidth, b.width);
    const room = window.innerHeight - b.bottom - 8;
    const top = room >= h || b.top - 8 < h ? Math.min(b.bottom + 4, window.innerHeight - h - 8) : b.top - h - 4;
    setPos({ top: Math.max(8, top), left: Math.max(8, Math.min(b.left, window.innerWidth - w - 8)), minWidth: b.width });
  }, [open, options.length]);

  useEffect(() => {
    if (open && active >= 0) menu.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const pick = (o: PickerOption<T>) => {
    if (o.disabled) return;
    button.current?.focus();
    setOpen(false);
    if (o.value !== value) onChange(o.value);
  };
  const next = (from: number, dir: 1 | -1): number => {
    for (let i = from + dir; i >= 0 && i < options.length; i += dir) if (!options[i]!.disabled) return i;
    return from;
  };
  const onMenuKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") setActive((i) => next(i, 1));
    else if (e.key === "ArrowUp") setActive((i) => next(i, -1));
    else if (e.key === "Home") setActive(next(-1, 1));
    else if (e.key === "End") setActive(next(options.length, -1));
    else if (e.key === "Enter" || e.key === " ") { const o = options[active]; if (o) pick(o); }
    else if (e.key === "Tab") { setOpen(false); return; }
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 800 ? typed.current.text : "") + e.key.toLowerCase(), at: now };
      const i = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(typed.current.text));
      if (i >= 0) setActive(i);
    } else return;
    e.preventDefault();
  };

  return (
    <>
      <button ref={button} type="button" className={`picker${sm ? " sm" : ""}${className ? ` ${className}` : ""}`} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={label} data-testid={testId} data-tip={open ? undefined : tip}
        data-dismiss-ignore onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => { if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); setOpen(true); } }}>
        {icon ?? chosen?.icon}
        <span className="picker-value ellipsis">{chosen?.label ?? placeholder}</span>
        <ChevronsUpDown size={12} className="picker-chev" aria-hidden />
      </button>
      {open && createPortal(
        <div ref={menu} id={id} className="menu picker-menu" role="listbox" aria-label={label} tabIndex={-1} style={pos} onKeyDown={onMenuKey}
          aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined} data-testid={testId ? `${testId}-menu` : undefined}>
          {options.map((o, i) => (
            <div key={o.value} id={`${id}-${i}`} data-i={i} role="option" aria-selected={o.value === value} aria-disabled={o.disabled || undefined}
              className={`picker-option${i === active ? " active" : ""}`} onPointerMove={() => { if (!o.disabled && i !== active) setActive(i); }} onClick={() => pick(o)}>
              <span className="picker-check">{o.value === value && <Check size={13} strokeWidth={2.6} />}</span>
              {o.icon}
              <span className="picker-text"><span className="ellipsis">{o.label}</span>{o.sub && <small className="ellipsis">{o.sub}</small>}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
