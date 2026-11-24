/**
 * Boards on another computer this window joined (Share): where that McBot is and this window's
 * member key. Kept per device; leaving forgets it. Read once at start: joining and leaving reload
 * the window. A window opened from a link in a web browser keeps the same, for its own address.
 */
import type { ShareRole } from "../../contracts/api";

export interface Remote {
  /** http://192.168.1.5:4318, or https://<words>.trycloudflare.com for anyone with the link. */
  url: string;
  key: string;
  /** Who is sharing, as shown in the title bar. */
  label: string;
  /** Can edit (a teammate) or Can chat (a guest); joins from before roles were teammates. */
  role?: ShareRole;
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

/** "192.168.1.5" or "192.168.1.5:4318" → "http://192.168.1.5:4318"; a full https address stays as it is. */
export function remoteUrl(address: string): string {
  const a = address.trim().replace(/\/+$/, "");
  if (/^https:\/\//i.test(a)) return a.replace(/^https:\/\//i, "https://");
  const bare = a.replace(/^http:\/\//i, "");
  return `http://${/:\d+$/.test(bare) ? bare : `${bare}:4318`}`;
}

export interface ParsedInvite {
  /** The computer's address to call: `http://192.168.1.20:4318` or `https://x.trycloudflare.com`. */
  url: string;
  /** As people read it: `192.168.1.20:4318`, `x.trycloudflare.com`. */
  address: string;
  code: string;
}

/**
 * "http://192.168.1.20:4318/join?code=K7Q-4XM-2PD", "https://x.trycloudflare.com/join?code=…",
 * or "192.168.1.20:4318 · K7Q-4XM" pasted from a message.
 */
export function parseInvite(text: string): ParsedInvite | null {
  const t = text.trim();
  const link = /(https?:\/\/)?([\w.-]+(?::\d+)?)\/join\?code=([A-Za-z0-9-]+)/i.exec(t);
  if (link) {
    const address = link[2]!;
    const url = /^https:/i.test(link[1] ?? "") ? `https://${address}` : remoteUrl(address);
    return { url, address, code: link[3]!.toUpperCase() };
  }
  const pair = /([\w.-]+:\d+)\D+?([A-Za-z2-9]{3}(?:-?[A-Za-z2-9]{3}){1,2})\b/.exec(t);
  return pair ? { url: remoteUrl(pair[1]!), address: pair[1]!, code: pair[2]!.toUpperCase() } : null;
}
