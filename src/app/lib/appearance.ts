/**
 * Appearance: McBot is dark, always (the owner's decision); the person picks the accent colour,
 * as macOS offers it, and how big everything is drawn. Kept per computer (localStorage, like the
 * rail's pins); every window follows a change at once (the `storage` event). The CSS lives in
 * styles/tokens.css: `data-accent` on <html> picks the accent's tokens. The size is the app
 * window's own zoom (Tauri's webview zoom: text, controls and the board grow together, and React
 * Flow keeps working, which a CSS zoom would break); in a web browser the browser's zoom does it.
 */
export const ACCENTS = ["blue", "purple", "pink", "red", "orange", "yellow", "green", "graphite"] as const;
export type Accent = (typeof ACCENTS)[number];
/** How big the app is drawn. Larger than 100% by default: the owner found 100% too small to read. */
export const SCALES = [1, 1.1, 1.2, 1.3, 1.45] as const;
export interface Appearance { accent: Accent; scale: number }

/** Each accent's swatch, for the picker. */
export const ACCENT_SWATCH: Record<Accent, string> = {
  blue: "#0a84ff", purple: "#bf5af2", pink: "#ff375f", red: "#ff453a", orange: "#ff9f0a", yellow: "#ffd60a", green: "#30d158", graphite: "#98989d",
};

export const APPEARANCE_KEY = "mcbot.appearance";
export const DEFAULT_APPEARANCE: Appearance = { accent: "blue", scale: 1.2 };

/** Read a stored preference; anything unknown falls back to the default. */
export function parseAppearance(raw: string | null): Appearance {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<Appearance> | null;
    return {
      accent: (ACCENTS as readonly string[]).includes(v?.accent as string) ? (v!.accent as Accent) : DEFAULT_APPEARANCE.accent,
      scale: (SCALES as readonly number[]).includes(v?.scale as number) ? (v!.scale as number) : DEFAULT_APPEARANCE.scale,
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

/** The next size up or down (⌘+ / ⌘−), or the same one at either end. */
export function stepScale(scale: number, dir: 1 | -1): number {
  const i = SCALES.findIndex((s) => s >= scale - 0.001);
  return SCALES[Math.min(SCALES.length - 1, Math.max(0, (i < 0 ? SCALES.length - 1 : i) + dir))]!;
}

const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
let zoom = 1;
/** The app window's zoom now (1 in a web browser): CSS pixels times this are the window's own. */
export const uiZoom = () => zoom;

async function applyZoom(scale: number): Promise<void> {
  if (!inTauri() || zoom === scale) return;
  zoom = scale;
  try {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().setZoom(scale);
  } catch {
    zoom = 1;
  }
}

/** Put the accent on <html> (synchronously: call it before the first paint), and zoom the app window. */
export function applyAppearance(a: Appearance, root: HTMLElement = document.documentElement): void {
  if (a.accent === "blue") delete root.dataset.accent;
  else root.dataset.accent = a.accent;
  void applyZoom(a.scale);
}

/** Another window changed the appearance: `run` gets the new one. Returns the unsubscribe. */
export function onAppearanceElsewhere(run: (a: Appearance) => void): () => void {
  const on = (e: StorageEvent) => { if (e.key === APPEARANCE_KEY) run(parseAppearance(e.newValue)); };
  window.addEventListener("storage", on);
  return () => window.removeEventListener("storage", on);
}
