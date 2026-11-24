/**
 * Appearance: McBot is dark, always (the owner's decision); the person picks the accent colour,
 * as macOS offers it. Kept per computer (localStorage, like the rail's pins); every window follows
 * a change at once (the `storage` event). The CSS lives in styles/tokens.css: `data-accent` on
 * <html> picks the accent's tokens.
 */
export const ACCENTS = ["blue", "purple", "pink", "red", "orange", "yellow", "green", "graphite"] as const;
export type Accent = (typeof ACCENTS)[number];
export interface Appearance { accent: Accent }

/** Each accent's swatch, for the picker. */
export const ACCENT_SWATCH: Record<Accent, string> = {
  blue: "#0a84ff", purple: "#bf5af2", pink: "#ff375f", red: "#ff453a", orange: "#ff9f0a", yellow: "#ffd60a", green: "#30d158", graphite: "#98989d",
};

export const APPEARANCE_KEY = "mcbot.appearance";
export const DEFAULT_APPEARANCE: Appearance = { accent: "blue" };

/** Read a stored preference; anything unknown falls back to the default. */
export function parseAppearance(raw: string | null): Appearance {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<Appearance> | null;
    return { accent: (ACCENTS as readonly string[]).includes(v?.accent as string) ? (v!.accent as Accent) : DEFAULT_APPEARANCE.accent };
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

/** Put the accent on <html> (synchronously: call it before the first paint). */
export function applyAppearance(a: Appearance, root: HTMLElement = document.documentElement): void {
  if (a.accent === "blue") delete root.dataset.accent;
  else root.dataset.accent = a.accent;
}

/** Another window changed the appearance: `run` gets the new one. Returns the unsubscribe. */
export function onAppearanceElsewhere(run: (a: Appearance) => void): () => void {
  const on = (e: StorageEvent) => { if (e.key === APPEARANCE_KEY) run(parseAppearance(e.newValue)); };
  window.addEventListener("storage", on);
  return () => window.removeEventListener("storage", on);
}
