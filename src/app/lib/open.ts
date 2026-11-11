import { DEMO } from "./engine";

/**
 * Open a web page in the person's browser. In the desktop app a plain link does not
 * leave the window, so the shell's opener plugin asks the system (https only, see
 * src-tauri/capabilities/default.json); in a browser it is an ordinary new tab.
 */
export async function openExternal(url: string): Promise<void> {
  if (!DEMO && typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
