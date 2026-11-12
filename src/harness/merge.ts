/**
 * The careful writer (decision 9 in docs/PLAN.md): a compiled config.yaml is merged into the one
 * on disk instead of replacing it. McBot owns exactly the keys the board shows (`OWNED`), and only
 * those change; every other key, and its comments and place, stays as Hermes, the CLI, an agent
 * or a person left it. Pure: the engine's writer reads the old file and writes the result.
 *
 * Stable: merging a file McBot just wrote gives back the same bytes, so "compile first" (a run is
 * refused while the board and the disk differ) only fires on real changes.
 */
import { isMap, parseDocument, type Document } from "yaml";
import { MEDIA_PROVIDERS, SLUG_RE } from "../contracts/graph";
import { canonicalText } from "../compile/text";

/** A key McBot owns outright, a map of owned sub-keys, or a family of entries McBot owns. */
type Owned = true | { readonly [key: string]: Owned } | { readonly entries: (key: string, parent: Record<string, unknown>) => boolean };

const maker = (media: "image" | "video") => ({
  // A maker the board cannot show (a provider it does not know) is the person's: left alone.
  entries: (key: string, parent: Record<string, unknown>) =>
    (key === "provider" || key === "model") && (parent.provider === undefined || (typeof parent.provider === "string" && parent.provider in MEDIA_PROVIDERS[media])),
});

/** What compile writes (src/compile/config.ts), key by key. */
export const OWNED: { readonly [key: string]: Owned } = {
  model: { provider: true, default: true },
  providers: { entries: (k) => k.startsWith("mcbot-") },
  fallback_providers: true,
  mcp_servers: { entries: (k) => SLUG_RE.test(k) },
  platform_toolsets: { cli: true, api_server: true },
  browser: { headed: true, engine: true, use_real_profile: true },
  image_gen: maker("image"),
  video_gen: maker("video"),
  platforms: { telegram: { extra: { base_url: true } } },
};

type Path = (string | number)[];
const OPTIONS = { lineWidth: 0, indent: 2 } as const;

function keysAt(doc: Document, path: Path): string[] {
  const node = path.length ? doc.getIn(path, true) : doc.contents;
  return isMap(node) ? node.items.map((p) => String((p.key as { value?: unknown })?.value ?? p.key)) : [];
}

function apply(doc: Document, next: Document, path: Path, owned: Owned, previous: Document): void {
  if (owned === true) {
    const value = next.getIn(path, true);
    if (value === undefined) {
      if (doc.hasIn(path)) doc.deleteIn(path);
      return;
    }
    // Set at the first level that is missing, as compile wrote it (a fresh map, not a 1.1 !!omap).
    for (let i = 1; i <= path.length; i++) {
      const at = path.slice(0, i);
      if (i === path.length || !isMap(doc.getIn(at, true))) {
        doc.setIn(at, next.getIn(at, true));
        return;
      }
    }
    return;
  }
  if ("entries" in owned && typeof owned.entries === "function") {
    const keys = new Set([...keysAt(doc, path), ...keysAt(next, path)]);
    const before = previous.getIn(path);
    const parent = (before && typeof before === "object" ? (before as { toJSON?: () => unknown }).toJSON?.() ?? before : {}) as Record<string, unknown>;
    for (const k of keys) if (owned.entries(k, parent)) apply(doc, next, [...path, k], true, previous);
  } else {
    for (const [k, sub] of Object.entries(owned as { [key: string]: Owned })) apply(doc, next, [...path, k], sub, previous);
  }
  // A map McBot emptied (every key it held removed) goes too; one with someone else's keys stays.
  const node = path.length ? doc.getIn(path, true) : null;
  if (isMap(node) && node.items.length === 0 && !next.hasIn(path)) doc.deleteIn(path);
}

/**
 * The config.yaml to write: `compiled` merged into `existing`. A missing, unreadable or non-map
 * file is replaced (Hermes could not read it either), and the diff shows it.
 */
export function mergeConfig(existing: string | null, compiled: string): string {
  if (existing === null || existing === compiled) return compiled;
  // compile's header comment is McBot's: the new one replaces the old one, other comments stay.
  const header = /^(#.*\n)*/.exec(compiled)![0];
  const body = /^# Compiled by McBot/.test(existing) ? existing.replace(/^(#.*\n)*/, "") : existing;
  const doc = parseDocument(body, { version: "1.1" });
  if (doc.errors.length || (doc.contents !== null && !isMap(doc.contents))) return compiled;
  const next = parseDocument(compiled.slice(header.length), { version: "1.1" });
  const previous = doc.clone();
  // Keys McBot now writes that were not there go at the end, in compile's order.
  for (const [k, owned] of Object.entries(OWNED)) apply(doc, next, [k], owned, previous);
  const text = doc.contents === null || (isMap(doc.contents) && doc.contents.items.length === 0) ? "" : doc.toString(OPTIONS);
  return canonicalText(header + text);
}
