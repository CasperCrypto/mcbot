/**
 * Appearance: light, dark or the system's, and the accent colour, as macOS offers them.
 * Kept per computer (localStorage, like the rail's pins); every window follows a change at once
 * (the `storage` event), and the desktop shell's window follows too (title bar, traffic lights).
 * The CSS lives in styles/tokens.css: `data-theme` and `data-accent` on <html> pick the tokens.
 */
export type ThemePref = "system" | "light" | "dark";
export type Theme = "light" | "dark";
export const ACCENTS = ["blue", "purple", "pink", "red", "orange", "yellow", "green", "graphite"] as const;
export type Accent = (typeof ACCENTS)[number];
export interface Appearance { theme: ThemePref; accent: Accent }

/** Each accent's swatch (its dark-appearance colour), for the picker. */
export const ACCENT_SWATCH: Record<Accent, string> = {
  blue: "#0a84ff", purple: "#bf5af2", pink: "#ff375f", red: "#ff453a", orange: "#ff9f0a", yellow: "#ffd60a", green: "#30d158", graphite: "#98989d",
};

export const APPEARANCE_KEY = "mcbot.appearance";
/** Dark is McBot's own look; light and the system's are a choice. */
export const DEFAULT_APPEARANCE: Appearance = { theme: "dark", accent: "blue" };

/** Read a stored preference; anything unknown falls back to the default, field by field. */
export function parseAppearance(raw: string | null): Appearance {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<Appearance> | null;
    return {
      theme: v?.theme === "light" || v?.theme === "dark" || v?.theme === "system" ? v.theme : DEFAULT_APPEARANCE.theme,
      accent: (ACCENTS as readonly string[]).includes(v?.accent as string) ? (v!.accent as Accent) : DEFAULT_APPEARANCE.accent,
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function loadAppearance(): Appearance {
  try {
    return parseAppearance(localStorage.getItem(APPEARANCE_KEY));
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function saveAppearance(a: Appearance): void {
  try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(a)); } catch { /* not kept, still applied */ }
}

/** The appearance the window shows for a preference. */
export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
  return pref === "system" ? (systemDark ? "dark" : "light") : pref;
}

const systemQuery = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null);
export const systemDark = () => systemQuery()?.matches ?? true;

/** The window background behind the page (also the native window's, so a resize never flashes). */
export const WINDOW_BG: Record<Theme, string> = { dark: "#151516", light: "#e8e8ec" };

/** Put the appearance on <html> (synchronously: call it before the first paint). Returns the theme shown. */
export function applyAppearance(a: Appearance, root: HTMLElement = document.documentElement): Theme {
  const theme = resolveTheme(a.theme, systemDark());
  root.dataset.theme = theme;
  if (a.accent === "blue") delete root.dataset.accent;
  else root.dataset.accent = a.accent;
  root.style.colorScheme = theme;
  return theme;
}

/** Call `run` when the system switches between light and dark. Returns the unsubscribe. */
export function onSystemTheme(run: () => void): () => void {
  const q = systemQuery();
  if (!q) return () => undefined;
  q.addEventListener("change", run);
  return () => q.removeEventListener("change", run);
}

/** Another window changed the appearance: `run` gets the new one. Returns the unsubscribe. */
export function onAppearanceElsewhere(run: (a: Appearance) => void): () => void {
  const on = (e: StorageEvent) => { if (e.key === APPEARANCE_KEY) run(parseAppearance(e.newValue)); };
  window.addEventListener("storage", on);
  return () => window.removeEventListener("storage", on);
}
