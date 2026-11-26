import { DEMO } from "./engine";

/**
 * Open a web page in the person's browser. In the desktop app a plain link does not
 * leave the window, so the shell's opener plugin asks the system (https and mailto: only, see
 * src-tauri/capabilities/default.json); in a browser it is an ordinary new tab.
 */
const inApp = () => !DEMO && typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function openExternal(url: string): Promise<void> {
  if (inApp()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/** The desktop app can show a file in Finder or Explorer; a browser cannot. */
export const canReveal = (): boolean => inApp();

/** What the system calls showing a file where it is: Finder on a Mac, Explorer on Windows. */
export const revealLabel = (): string => (/Mac/i.test(navigator.userAgent) ? "Show in Finder" : /Win/i.test(navigator.userAgent) ? "Show in Explorer" : "Show in folder");

/** Show a file in Finder or Explorer (an export, a file in Files). */
export async function revealFile(path: string): Promise<void> {
  if (!inApp()) return;
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
}
