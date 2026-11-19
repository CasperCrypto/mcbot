/**
 * The Browser view's iframe (the browser build, and Linux where the desktop page is a separate
 * window): most sites refuse to be framed (X-Frame-Options, CSP frame-ancestors) and show a
 * blank page. Asking first lets the view say so and offer a window instead. Host only.
 */
export function frameableFromHeaders(headers: Headers): boolean {
  const xfo = (headers.get("x-frame-options") ?? "").trim().toLowerCase();
  if (xfo === "deny" || xfo === "sameorigin") return false;
  const csp = headers.get("content-security-policy") ?? "";
  const fa = /(?:^|;)\s*frame-ancestors\s+([^;]*)/i.exec(csp)?.[1]?.trim().toLowerCase();
  if (fa !== undefined) return fa.split(/\s+/).includes("*");
  return true;
}

/**
 * Whether the page answers at all (`reachable`: any HTTP status counts; no answer, a refused port or
 * a failed lookup does not), and whether it may be framed. The Browser view shows McBot's own
 * "can't reach" screen when it doesn't answer, never the web engine's (WebView2's is Edge's).
 */
export async function frameable(url: string, timeoutMs = 5000): Promise<{ frameable: boolean; url: string; reachable: boolean }> {
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:") return { frameable: false, url, reachable: false };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(u, { redirect: "follow", signal: ctl.signal, headers: { accept: "text/html" } });
    void res.body?.cancel().catch(() => undefined);
    return { frameable: frameableFromHeaders(res.headers), url: res.url || url, reachable: true };
  } catch {
    // Unreachable from here (offline, a local server that is down, a name that doesn't resolve).
    return { frameable: true, url, reachable: false };
  } finally {
    clearTimeout(t);
  }
}
