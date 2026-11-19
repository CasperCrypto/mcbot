/**
 * "A new version is out": the engine asks GitHub for McBot's newest published release (the same
 * place the website's download buttons and `site/install.sh` read), at start and every 6 hours.
 * Nothing about this computer is sent; the request carries no identity. Installing stays the
 * person's choice (the release page); the signed Tauri updater comes with signing (docs/PLAN.md).
 */
import type { UpdateView } from "../src/contracts/api";

export const RELEASES_API = "https://api.github.com/repos/CasperCrypto/mcbot/releases/latest";

/** "v0.10.0" > "0.9.3"; anything that is not x.y.z compares as older. */
export function newer(latest: string, current: string): boolean {
  const parse = (v: string) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())?.slice(1).map(Number) ?? null;
  const a = parse(latest);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
}

export function updateFromRelease(body: unknown, current: string): UpdateView {
  const r = (body ?? {}) as { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown };
  const tag = typeof r.tag_name === "string" ? r.tag_name : null;
  const url = typeof r.html_url === "string" && r.html_url.startsWith("https://github.com/") ? r.html_url : null;
  if (!tag || !url || r.draft === true || r.prerelease === true) return { current, latest: null, url: null, available: false };
  const latest = tag.replace(/^v/, "");
  return { current, latest, url, available: newer(latest, current) };
}

export function updateChecker(current: string, fetchImpl: typeof fetch = fetch) {
  let last: UpdateView = { current, latest: null, url: null, available: false };
  let at = 0;
  const check = async (): Promise<UpdateView> => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetchImpl(RELEASES_API, { signal: ctl.signal, headers: { accept: "application/vnd.github+json", "user-agent": "mcbot-studio" } });
      if (res.ok) last = updateFromRelease(await res.json(), current);
    } catch {
      // Offline or rate-limited: keep what we knew; nothing to say.
    } finally {
      clearTimeout(t);
      at = Date.now();
    }
    return last;
  };
  return {
    /** The last answer, refreshed when it is older than 6 hours. */
    get: async (): Promise<UpdateView> => (Date.now() - at > 6 * 3600_000 ? check() : last),
  };
}
