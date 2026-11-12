/**
 * Joined boards on another computer (Share on your network): where that McBot is and this
 * window's member key. Kept per device; leaving forgets it. Read once at start: joining and
 * leaving reload the window.
 */
export interface Remote {
  /** http://192.168.1.5:4318 */
  url: string;
  key: string;
  /** Who is sharing, as shown in the title bar. */
  label: string;
}

const KEY = "mcbot.remote";

export function loadRemote(): Remote | null {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? "null") as Remote | null;
    return r?.url && r.key ? r : null;
  } catch {
    return null;
  }
}

export function saveRemote(r: Remote | null): void {
  try {
    if (r) localStorage.setItem(KEY, JSON.stringify(r));
    else localStorage.removeItem(KEY);
  } catch {
    /* this window only */
  }
}

/** "192.168.1.5" or "192.168.1.5:4318" → "http://192.168.1.5:4318". */
export function remoteUrl(address: string): string {
  const a = address.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return `http://${/:\d+$/.test(a) ? a : `${a}:4318`}`;
}
