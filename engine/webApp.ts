/**
 * The app itself, for people who join in a web browser (Share): the built UI (`dist/`, in the
 * installed app the `web/` resource, MCBOT_WEB_DIR) served on the share port. Static files only,
 * none of them data: the page then asks for a member key like McBot's own windows do. Only files
 * inside the folder, never a dotfile; the page gets a strict Content-Security-Policy.
 */
import { existsSync, statSync } from "node:fs";
import { extname, normalize, resolve, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

/** Paths the app answers itself (it reads them from location): its page. */
export const APP_PAGES = /^\/(?:join|chat)?\/?$/;

export interface WebFile {
  abs: string;
  type: string;
  /** Vite names everything under assets/ by its hash, so it never changes. */
  immutable: boolean;
}

/** A file of the built app for a request path, or null (outside the folder, a dotfile, missing). */
export function webFile(dir: string, pathname: string): WebFile | null {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (path.includes("\0")) return null;
  const rel = normalize(path).replace(/^[/\\]+/, "");
  if (!rel || rel.split(/[/\\]/).some((part) => part.startsWith("."))) return null;
  const root = resolve(dir);
  const abs = resolve(root, rel);
  if (!abs.startsWith(root + sep)) return null;
  try {
    if (!existsSync(abs) || !statSync(abs).isFile()) return null;
  } catch {
    return null;
  }
  return { abs, type: TYPES[extname(abs).toLowerCase()] ?? "application/octet-stream", immutable: /^assets[/\\]/.test(rel) };
}

/** The page's policy: its own scripts, styles and fonts; talk only to this address. */
export function pagePolicy(host: string): string {
  const h = host.replace(/[^\w.:[\]-]/g, "");
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    `connect-src 'self' ws://${h} wss://${h}`,
    "worker-src 'self' blob:",
    "frame-src http: https:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export const hasWebApp = (dir: string | undefined): dir is string => !!dir && existsSync(resolve(dir, "index.html"));
