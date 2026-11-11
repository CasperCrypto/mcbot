import { DEMO } from "./engine";

/**
 * The desktop shell's signals: the menu bar icon's "needs you" count and system notifications.
 * Both do nothing in a browser (the demo, `npm run dev` in a browser tab).
 */
const inApp = () => !DEMO && typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

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

/** Show a web page in McBot's browser window (desktop), or a new tab (browser). http(s) only. */
export async function openBrowser(url: string): Promise<void> {
  const u = /^[a-z]+:\/\//i.test(url) ? url : `http://${url}`;
  if (!/^https?:\/\//i.test(u)) throw new Error("Only http and https pages open here");
  if (!inApp()) {
    window.open(u, "_blank", "noopener,noreferrer");
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("browser_open", { url: u });
}
