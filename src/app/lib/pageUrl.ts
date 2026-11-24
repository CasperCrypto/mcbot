/** The browser view's addresses: what people type, and what the page frame may load (pure). */

/** "localhost:3000" → "http://localhost:3000"; "mcbot docs" → a search. */
export function toUrl(input: string): string {
  const v = input.trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(v)) return `http://${v}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(v)) return `https://${v}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(v)}`;
}

/**
 * What the page frame may load: a web page, rebuilt behind its own http(s) scheme; anything else
 * (javascript:, data:, file:…) is a blank page. toUrl only makes web addresses, this makes sure.
 */
export function framedUrl(u: string): string {
  let p: URL;
  try {
    p = new URL(u);
  } catch {
    return "about:blank";
  }
  const rest = `${p.host}${p.pathname}${p.search}${p.hash}`;
  const page = p.protocol === "https:" ? `https://${rest}` : p.protocol === "http:" ? `http://${rest}` : null;
  // Quotes and angle brackets are never part of an address: escaped, they can't become markup either.
  return page ? page.replace(/["'<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`) : "about:blank";
}
