/**
 * The desktop shell's terminals (src-tauri/src/terminal.rs): open a shell in a folder, stream its
 * output, type into it. Not available in a browser.
 */
import { DEMO } from "../lib/engine";

export const terminalsAvailable = (): boolean => !DEMO && typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface ShellSession {
  id: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function openShell(cwd: string, cols: number, rows: number, onData: (bytes: Uint8Array) => void, onExit: () => void): Promise<ShellSession> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const id = await invoke<number>("terminal_open", { cwd, cols, rows });
  const offData = await listen<{ id: number; data: string }>("terminal-output", (e) => { if (e.payload.id === id) onData(b64(e.payload.data)); });
  const offExit = await listen<{ id: number }>("terminal-exit", (e) => { if (e.payload.id === id) onExit(); });
  return {
    id,
    write: (data) => void invoke("terminal_write", { id, data }).catch(() => undefined),
    resize: (c, r) => void invoke("terminal_resize", { id, cols: c, rows: r }).catch(() => undefined),
    close: () => {
      offData();
      offExit();
      void invoke("terminal_close", { id }).catch(() => undefined);
    },
  };
}
