/**
 * The workbench browser's favorites and recently visited pages, kept per computer (localStorage),
 * and the brand mark of a site for its tile (lib/logos.generated.ts, Simple Icons).
 */
import { logoFor } from "../graph/Logo";
import { LOGOS, type Logo } from "./logos.generated";

export interface Site {
  url: string;
  title: string;
  /** When it was visited (recent pages). */
  at?: number;
}

const FAVORITES = "mcbot.browser.favorites";
const RECENT = "mcbot.browser.recent";
export const RECENT_MAX = 12;

export const DEFAULT_FAVORITES: readonly Site[] = [
  { url: "https://github.com", title: "GitHub" },
  { url: "https://mail.google.com", title: "Gmail" },
  { url: "https://calendar.google.com", title: "Calendar" },
  { url: "https://www.notion.so", title: "Notion" },
  { url: "https://www.figma.com", title: "Figma" },
  { url: "https://huggingface.co", title: "Hugging Face" },
  { url: "https://www.youtube.com", title: "YouTube" },
  { url: "https://en.wikipedia.org", title: "Wikipedia" },
];

/** Sites whose mark isn't named like the site (mail.google.com is Gmail). */
const SITE_KEYS: readonly [RegExp, string][] = [
  [/^mail\.google\.com$/, "gmail"], [/^calendar\.google\.com$/, "googlecalendar"], [/^drive\.google\.com$/, "googledrive"],
  [/(^|\.)youtube\.com$|^youtu\.be$/, "youtube"], [/(^|\.)wikipedia\.org$/, "wikipedia"], [/^news\.ycombinator\.com$/, "ycombinator"],
  [/(^|\.)(x|twitter)\.com$/, "x"], [/(^|\.)huggingface\.co$/, "huggingface"], [/(^|\.)stackoverflow\.com$/, "stackoverflow"],
  [/(^|\.)producthunt\.com$/, "producthunt"], [/(^|\.)claude\.ai$/, "claude"], [/(^|\.)perplexity\.ai$/, "perplexity"], [/(^|\.)zoom\.us$/, "zoom"],
];

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};

/** A site's brand mark, by its address: Gmail for mail.google.com, GitHub for github.com… */
export function siteLogo(url: string): Logo | null {
  const host = hostOf(url);
  const hit = SITE_KEYS.find(([re]) => re.test(host));
  if (hit && LOGOS[hit[1]]) return LOGOS[hit[1]]!;
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) return null;
  return logoFor([], url);
}

/** "https://www.notion.so/team/page" → "notion.so". */
export const siteName = (url: string) => hostOf(url).replace(/^www\./, "") || url;

/** One address per page: no trailing slash, no #fragment. */
export const samePage = (a: string, b: string) => a.replace(/#.*$/, "").replace(/\/+$/, "") === b.replace(/#.*$/, "").replace(/\/+$/, "");

function read(key: string): Site[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null") as unknown;
    return Array.isArray(v) ? v.filter((s): s is Site => !!s && typeof (s as Site).url === "string" && typeof (s as Site).title === "string") : null;
  } catch {
    return null;
  }
}
function write(key: string, list: Site[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* this window only */
  }
}

export const loadFavorites = (): Site[] => read(FAVORITES) ?? [...DEFAULT_FAVORITES];
export function saveFavorites(list: Site[]): Site[] {
  write(FAVORITES, list);
  return list;
}
export const isFavorite = (list: readonly Site[], url: string) => list.some((f) => samePage(f.url, url));
export function toggleFavorite(list: Site[], url: string, title = siteName(url)): Site[] {
  return saveFavorites(isFavorite(list, url) ? list.filter((f) => !samePage(f.url, url)) : [...list, { url, title }]);
}

export const loadRecent = (): Site[] => read(RECENT) ?? [];
/** A visited page goes to the top of the recent list (once), which keeps the last few. */
export function addRecent(url: string, now = Date.now()): Site[] {
  if (!/^https?:\/\//i.test(url)) return loadRecent();
  const list = [{ url, title: siteName(url), at: now }, ...loadRecent().filter((s) => !samePage(s.url, url))].slice(0, RECENT_MAX);
  write(RECENT, list);
  return list;
}
export function clearRecent(): void {
  write(RECENT, []);
}
