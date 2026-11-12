/**
 * Read a Hermes setup from disk for src/harness/read.ts: each profile's config.yaml, SOUL.md,
 * profile.yaml and top-level skills/<dir>/SKILL.md. From `.env` it reads only which variables
 * are set, plus the allowed Telegram users (a list of ids, not a secret): never a key's value.
 *
 * Hermes' root is itself the `default` profile (hermes_cli/profiles.py); `default` is a reserved
 * profile id, so a board shows it as an agent named `main`.
 */
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ChannelNode, Graph } from "../src/contracts/graph";
import { readHermes, type ProfileFiles, type ReadResult } from "../src/harness/read";
import { readTextOrNull } from "./fsutil";

const SKILL_FILE = "SKILL.md";

async function dirs(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name).sort();
  } catch {
    return [];
  }
}

/** Names of the variables set in a .env, and the value of the few that are not secrets. */
export function envFacts(text: string | null): { names: Set<string>; allowedTelegram: string[] } {
  const names = new Set<string>();
  let allowed = "";
  for (const line of (text ?? "").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const value = m[2]!.trim().replace(/^(["'])(.*)\1$/, "$2");
    if (!value) continue;
    names.add(m[1]!);
    if (m[1] === "TELEGRAM_ALLOWED_USERS") allowed = value;
  }
  return { names, allowedTelegram: allowed.split(",").map((s) => s.trim()).filter((s) => /^\d{1,20}$/.test(s)) };
}

export async function profileFiles(name: string, dir: string): Promise<{ files: ProfileFiles; env: string | null }> {
  const skills: Record<string, string> = {};
  for (const d of await dirs(join(dir, "skills"))) {
    // A folder without its own SKILL.md is one of Hermes' skill categories (seeded or installed):
    // listed as not editable on the board yet, never dropped silently.
    skills[d] = (await readTextOrNull(join(dir, "skills", d, SKILL_FILE))) ?? "";
  }
  const [config, soul, profileYaml, env] = await Promise.all(
    ["config.yaml", "SOUL.md", "profile.yaml", ".env"].map((f) => readTextOrNull(join(dir, f))),
  );
  return { files: { name, config: config ?? null, soul: soul ?? null, profileYaml: profileYaml ?? null, skills }, env: env ?? null };
}

/** Is this folder a Hermes home (a config.yaml or a profiles/ folder)? */
export async function isHermesHome(root: string): Promise<boolean> {
  const has = async (p: string) => stat(join(root, p)).then(() => true, () => false);
  return (await has("config.yaml")) || (await has("profiles"));
}

export async function readSetup(root: string, board: { id: string; name: string }): Promise<ReadResult> {
  const found: { files: ProfileFiles; env: string | null }[] = [];
  for (const name of await dirs(join(root, "profiles"))) found.push(await profileFiles(name, join(root, "profiles", name)));
  const main = await profileFiles("main", root);
  const rootUsed = main.files.config !== null || main.files.soul !== null;
  if (rootUsed && !found.some((p) => p.files.name === "main")) found.push(main);

  const result = readHermes(board, found.map((p) => p.files));
  if (rootUsed) {
    result.unshown.unshift(found.includes(main)
      ? { profile: "main", what: "default profile", why: "Hermes' own default profile, shown as the agent `main`" }
      : { profile: "default", what: "default profile", why: "a profile is already called main, so the default one is not shown" });
  }
  addTelegram(result.graph, found);
  return result;
}

/** A bot whose token is in the agent's .env (no own server, so nothing in config.yaml). */
function addTelegram(graph: Graph, found: { files: ProfileFiles; env: string | null }[]): void {
  for (const { files, env } of found) {
    const facts = envFacts(env);
    const agentId = `n-agent-${files.name}`;
    if (!facts.names.has("TELEGRAM_BOT_TOKEN") || !graph.nodes.some((n) => n.id === agentId)) continue;
    const wired = graph.edges.some((e) => e.source === agentId && graph.nodes.find((n) => n.id === e.target)?.kind === "channel");
    if (wired) continue;
    const name = `${files.name}-telegram`.slice(0, 64);
    const node: ChannelNode = {
      id: `n-${name}`, kind: "channel", position: { x: 360, y: graph.nodes.length * 60 },
      // The token itself stays where it is; the person saves it in McBot to run the bot from here.
      data: { name, label: "", platform: "telegram", tokenEnv: "", allowedUsers: facts.allowedTelegram, apiBase: "" },
    };
    graph.nodes.push(node);
    graph.edges.push({ id: `e-agent-${files.name}-${name}`, source: agentId, target: node.id, order: 0 });
  }
}
