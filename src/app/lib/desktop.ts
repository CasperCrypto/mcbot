import { DEMO } from "./engine";

/**
 * The desktop shell's signals: the menu bar icon's "needs you" count and system notifications.
 * Both do nothing in a browser (the demo, `npm run dev` in a browser tab).
 */
export const inApp = () => !DEMO && typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let lastCount = -1;
/** How many things need the person: shown next to the menu bar icon (src-tauri `set_attention`). */
export async function setAttention(count: number): Promise<void> {
  if (!inApp() || count === lastCount) return;
  lastCount = count;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_attention", { count }).catch(() => undefined);
}

let allowed: boolean | null = null;
/** A system notification, only while no McBot window is in front (the window itself shows everything). */
export async function notify(title: string, body: string): Promise<void> {
  if (!inApp() || document.hasFocus()) return;
  const n = await import("@tauri-apps/plugin-notification");
  allowed ??= (await n.isPermissionGranted()) || (await n.requestPermission()) === "granted";
  if (allowed) n.sendNotification({ title, body: body.slice(0, 180) });
}

/**
 * Open a web page in the person's own browser (desktop: the system default, through the opener
 * plugin; a browser tab otherwise). http(s) only: any https page, and http on this computer
 * (an agent's preview server), as src-tauri/capabilities/default.json allows.
 */
export async function openBrowser(url: string): Promise<void> {
  const u = /^[a-z]+:\/\//i.test(url) ? url : `http://${url}`;
  if (!/^https?:\/\//i.test(u)) throw new Error("Only http and https pages open here");
  if (!inApp()) {
    window.open(u, "_blank", "noopener,noreferrer");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(u);
}

/** The Browser view's page in the desktop app: a real webview over the view's page area
 * (src-tauri/src/browser.rs), because most sites refuse to load in an iframe. */
/** macOS and Windows place a child webview where it is told; Linux (GTK) stacks it below the
 * window's view instead, so there the Browser view keeps the iframe and the separate window. */
export const nativePage = () => inApp() && !/Linux/i.test(navigator.userAgent) && !/Android/i.test(navigator.userAgent);
export type PageBox = { x: number; y: number; w: number; h: number };
async function call(cmd: string, args: Record<string, unknown>): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke(cmd, args);
}
export const page = {
  show: (url: string, b: PageBox) => call("browser_show", { url, ...b }),
  bounds: (b: PageBox) => call("browser_bounds", { ...b }).catch(() => undefined),
  hide: () => call("browser_hide", {}).catch(() => undefined),
  go: (action: "back" | "forward" | "reload") => call("browser_go", { action }).catch(() => undefined),
  /** Where the page is now (links clicked inside it too). Returns the unlisten function. */
  async onUrl(fn: (url: string, loading: boolean) => void): Promise<() => void> {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow().listen<{ url: string; loading: boolean }>("browser:url", (e) => fn(e.payload.url, e.payload.loading));
  },
};
