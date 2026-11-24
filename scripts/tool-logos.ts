/**
 * Logos for tools, connectors, chat apps and model services, generated into
 * src/app/lib/logos.generated.ts so the app ships only the few it shows (no network, no runtime
 * package).
 *
 * Two sources, in this order:
 *   1. design/logos/<key>.svg: any SVG a person drops in (fills a gap or replaces one). Kept as a
 *      data: URI and drawn with <img>, so it can never run script inside McBot.
 *   2. Simple Icons (npm `simple-icons`, CC0): one-colour brand marks with the brand's hex.
 * A key with neither gets a lettered tile in the app.
 *
 *   npm run site:logos       write the file; `npm test` fails while it is stale
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as icons from "simple-icons";
import { CONNECTORS } from "../src/contracts/connectors.generated";
import { PLATFORMS } from "../src/contracts/platforms.generated";

const ROOT = join(import.meta.dirname ?? __dirname, "..");
export const OUT = join(ROOT, "src/app/lib/logos.generated.ts");
export const DROP = join(ROOT, "design/logos");

/** Our key → the Simple Icons slug, where the names differ. */
const ALIASES: Record<string, string> = {
  hugging_face: "huggingface", "unreal-engine": "unrealengine", "n8n-official": "n8n",
  "wordpress-com": "wordpress", "prisma-postgres": "prisma",
  photon: "imessage", google_chat: "googlechat", whatsapp_cloud: "whatsapp", weixin: "wechat", bluebubbles: "imessage", qqbot: "qq",
  gemini: "googlegemini", mistral: "mistralai", lmstudio: "lmstudio", "llama.cpp": "llamacpp",
};

/** Every key the app may ask for: connectors, catalog tools, chat apps, cloud and local model services, makers. */
function keys(): string[] {
  const catalog = ["exa", "parallel", "brave", "tavily", "firecrawl", "context7", "github", "notion", "knowledge", "thinking", "browser"];
  const services = ["openrouter", "openai", "anthropic", "gemini", "groq", "deepseek", "mistral", "together", "ollama", "lmstudio", "vllm", "jan", "fal", "xai", "krea", "deepinfra"];
  return [...new Set([...CONNECTORS.map((c) => c.name), ...catalog, ...Object.keys(PLATFORMS), ...services])].sort();
}

interface Icon { slug: string; title: string; hex: string; path: string }
const bySlug = new Map((Object.values(icons) as unknown[]).filter((i): i is Icon => !!i && typeof i === "object" && "slug" in i && "path" in i).map((i) => [i.slug, i]));

/** Relative luminance of a #rrggbb colour (WCAG). */
function lum(hex: string): number {
  const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

/** A key's Simple Icons mark (null when there is none): the brand's tile colour (null = near-black) and the glyph's ink. */
function markFor(key: string): { title: string; path: string; tile: string | null; ink: string } | null {
  const icon = bySlug.get(ALIASES[key] ?? key.replace(/[^a-z0-9]/g, ""));
  if (!icon) return null;
  const l = lum(icon.hex);
  const tile = l < 0.03 ? null : `#${icon.hex}`;
  return { title: icon.title, path: icon.path, tile, ink: tile && l > 0.5 ? "#000" : "#fff" };
}

export const SITE = join(ROOT, "site/index.html");
/** The website's "works with" rows: popular marks per group, between `<!-- logos:<group> -->` markers. */
export const SITE_GROUPS: Record<string, string[]> = {
  models: ["ollama", "lmstudio", "openrouter", "claude", "gemini", "mistral", "deepseek", "qwen", "meta", "vllm"],
  tools: ["github", "notion", "linear", "atlassian", "figma", "stripe", "supabase", "vercel", "sentry", "gitlab", "airtable", "todoist", "dropbox", "hugging_face", "cloudflare", "postman"],
  chat: ["telegram", "discord", "whatsapp", "signal", "matrix", "google_chat", "line", "mattermost"],
};

/**
 * site/index.html with each group drawn from the marks above: an app-style tile in the brand's own
 * colour (a near-black brand gets the page's dark tile), inline SVG: no requests, no script.
 */
export function renderSiteLogos(html: string): string {
  let out = html;
  for (const [group, keys] of Object.entries(SITE_GROUPS)) {
    const items = keys.map((k) => {
      const m = markFor(k);
      if (!m) throw new Error(`no mark for ${k}`);
      const tile = m.tile ? ` style="--c:${m.tile}"` : "";
      return `<li data-key="${k}"><span class="lg${m.tile ? "" : " dark"}"${tile}><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="${m.tile ? m.ink : "#fff"}" d="${m.path}"/></svg></span><span class="lg-name">${m.title}</span></li>`;
    });
    const re = new RegExp(`(<!-- logos:${group} -->)[\\s\\S]*?(<!-- /logos:${group} -->)`);
    if (!re.test(out)) continue;
    out = out.replace(re, (_m, a: string, b: string) => `${a}\n${items.join("\n")}\n${b}`);
  }
  return out;
}

export function renderLogos(): string {
  const dropped = existsSync(DROP) ? new Set(readdirSync(DROP).filter((f) => f.endsWith(".svg")).map((f) => f.slice(0, -4))) : new Set<string>();
  const rows: string[] = [];
  for (const key of [...new Set([...keys(), ...dropped])].sort()) {
    if (dropped.has(key)) {
      const svg = readFileSync(join(DROP, `${key}.svg`), "utf8").replace(/<\?xml[^>]*>/, "").replace(/\s+/g, " ").trim();
      rows.push(`  ${JSON.stringify(key)}: { src: ${JSON.stringify(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`)} },`);
      continue;
    }
    const icon = bySlug.get(ALIASES[key] ?? key.replace(/[^a-z0-9]/g, ""));
    if (!icon) continue;
    // A near-black mark sits on the neutral tile in white; a light one gets a dark glyph.
    const l = lum(icon.hex);
    const tile = l < 0.03 ? null : `#${icon.hex}`;
    const ink = tile && l > 0.5 ? "#000" : "#fff";
    rows.push(`  ${JSON.stringify(key)}: { title: ${JSON.stringify(icon.title)}, path: ${JSON.stringify(icon.path)}, tile: ${JSON.stringify(tile)}, ink: ${JSON.stringify(ink)} },`);
  }
  return [
    "// Generated by scripts/tool-logos.ts from design/logos/*.svg and Simple Icons (CC0). Do not edit.",
    "// Run `npm run site:logos` after adding a logo or a connector; `npm test` fails while this is stale.",
    "",
    "/** A brand mark: a dropped-in SVG (`src`), or a Simple Icons path drawn in `ink` on `tile` (null = neutral tile). */",
    "export type Logo = { src: string } | { title: string; path: string; tile: string | null; ink: string };",
    "",
    "export const LOGOS: Readonly<Record<string, Logo>> = {",
    ...rows,
    "};",
    "",
  ].join("\n");
}

if (process.argv[1] && /tool-logos\.ts$/.test(process.argv[1])) {
  writeFileSync(OUT, renderLogos());
  console.log(`wrote ${OUT}`);
  writeFileSync(SITE, renderSiteLogos(readFileSync(SITE, "utf8")));
  console.log(`wrote the logo wall in ${SITE}`);
}
