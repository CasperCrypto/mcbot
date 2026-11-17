/**
 * Hermes plugins for McBot's agents (verified on Hermes v0.23.2, docs/HERMES.md):
 *
 * - The curated catalog is `hermes/plugin-catalog/<name>.yaml` (name, title, description, category,
 *   tier, maintainer, repo, sha, version, platforms, capabilities). Read here directly, once.
 * - Per agent, with `hermes -p <agent> plugins …` (hermes_cli/subcommands/plugins.py):
 *   `list --json` ([{name, status, version, description, source}]), `install <name> --enable
 *   --yes-deps` (clones the pinned sha, scans it, enables it; no prompt), `enable <name>
 *   --no-allow-tool-override`, `disable <name>`, `remove <name>`. Hermes writes `plugins.enabled` /
 *   `plugins.disabled` in the agent's config.yaml itself; McBot never compiles those keys, so the
 *   config merge keeps them.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { CatalogPlugin, InstalledPlugin } from "../src/contracts/api";

export const PLUGIN_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
/** The first sentence, so a card stays short; the full text is a tooltip away. */
export const firstSentence = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  const m = /^(.{20,220}?[.!?])(\s|$)/.exec(t);
  return m ? m[1]! : t.length > 220 ? `${t.slice(0, 217)}…` : t;
};

let cache: { dir: string; items: CatalogPlugin[] } | null = null;

export function listPluginCatalog(hermesDir: string): CatalogPlugin[] {
  const dir = join(hermesDir, "plugin-catalog");
  if (cache?.dir === dir) return cache.items;
  const items: CatalogPlugin[] = [];
  if (existsSync(dir)) {
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith(".yaml")) continue;
      try {
        const y = parse(readFileSync(join(dir, file), "utf8")) as Record<string, unknown>;
        const name = str(y.name);
        if (!PLUGIN_NAME_RE.test(name)) continue;
        const caps = (y.capabilities ?? {}) as Record<string, unknown>;
        const description = str(y.description).replace(/\s+/g, " ").trim();
        items.push({
          name,
          title: str(y.title) || name,
          summary: firstSentence(description),
          description,
          category: str(y.category) || "other",
          tier: str(y.tier) || "community",
          maintainer: str(y.maintainer),
          repo: str(y.repo),
          version: str(y.version),
          platforms: list(y.platforms),
          tools: list(caps.provides_tools).length,
          hooks: list(caps.provides_hooks).length,
          needsKeys: list(caps.requires_env),
        });
      } catch {
        // a broken entry is left out, as Hermes' own loader does
      }
    }
  }
  cache = { dir, items };
  return items;
}

/** `hermes plugins list --json`, tolerant of anything printed before the JSON. */
export function parsePluginList(stdout: string): InstalledPlugin[] {
  const at = stdout.indexOf("[");
  if (at < 0) return [];
  try {
    const rows = JSON.parse(stdout.slice(at)) as Record<string, unknown>[];
    return rows.filter((r) => typeof r.name === "string").map((r) => ({
      name: String(r.name),
      enabled: r.status === "enabled",
      version: str(r.version),
      summary: firstSentence(str(r.description)),
      source: str(r.source),
    }));
  } catch {
    return [];
  }
}

export const listPluginsArgv = ["plugins", "list", "--json"] as const;
export const installPluginArgv = (name: string) => ["plugins", "install", name, "--enable", "--yes-deps"];
export const enablePluginArgv = (name: string) => ["plugins", "enable", name, "--no-allow-tool-override"];
export const disablePluginArgv = (name: string) => ["plugins", "disable", name];
export const removePluginArgv = (name: string) => ["plugins", "remove", name];
