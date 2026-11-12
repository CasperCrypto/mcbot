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
import { PLATFORMS, type ChannelNode, type Graph, type PlatformId } from "../src/contracts/graph";
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

/** Names of the variables set in a .env, and the values of those that are not secrets (`plain`). */
export function envFacts(text: string | null, plain: ReadonlySet<string> = new Set(["TELEGRAM_ALLOWED_USERS"])): { names: Set<string>; values: Map<string, string>; allowedTelegram: string[] } {
  const names = new Set<string>();
  const values = new Map<string, string>();
  for (const line of (text ?? "").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const value = m[2]!.trim().replace(/^(["'])(.*)\1$/, "$2");
    if (!value) continue;
    names.add(m[1]!);
    if (plain.has(m[1]!)) values.set(m[1]!, value);
  }
  const allowedTelegram = ids(values.get("TELEGRAM_ALLOWED_USERS") ?? "").filter((s) => /^\d{1,20}$/.test(s));
  return { names, values, allowedTelegram };
}

const ids = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);

/** Variables a chat app declares that are not secrets: its plain settings and who may message it. */
const PLAIN = new Set<string>(Object.values(PLATFORMS).flatMap((p) => [...p.required.filter((f) => !f.secret).map((f) => f.env), ...(p.allowedUsersEnv ? [p.allowedUsersEnv] : [])]));

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
  addChatApps(result.graph, found);
  return result;
}

/**
 * Chat apps set up in an agent's .env (Hermes' platform variables; config.yaml holds none but
 * Telegram's own server). Their secrets stay where they are: the person saves them in McBot to run
 * the bot from here. Plain settings and allowed users come along.
 */
function addChatApps(graph: Graph, found: { files: ProfileFiles; env: string | null }[]): void {
  for (const { files, env } of found) {
    const facts = envFacts(env, PLAIN);
    const agentId = `n-agent-${files.name}`;
    if (!graph.nodes.some((n) => n.id === agentId)) continue;
    for (const platform of Object.keys(PLATFORMS) as PlatformId[]) {
      const p = PLATFORMS[platform];
      const key = (p.required.find((f) => f.secret) ?? p.required[0])!.env;
      if (!facts.names.has(key)) continue;
      const wired = graph.edges.some((e) => e.source === agentId && graph.nodes.some((n) => n.id === e.target && n.kind === "channel" && n.data.platform === platform));
      if (wired) continue;
      const name = `${files.name}-${platform.replace(/_/g, "-")}`.slice(0, 64);
      const settings = Object.fromEntries(p.required.filter((f) => !f.secret && facts.values.has(f.env)).map((f) => [f.env, facts.values.get(f.env)!]));
      const users = p.allowedUsersEnv ? ids(facts.values.get(p.allowedUsersEnv) ?? "") : [];
      const node: ChannelNode = {
        id: `n-${name}`, kind: "channel", position: { x: 360, y: graph.nodes.length * 60 },
        data: { name, label: "", platform, tokenEnv: "", settings, allowedUsers: platform === "telegram" ? users.filter((u) => /^\d{1,20}$/.test(u)) : users, apiBase: "" },
      };
      graph.nodes.push(node);
      graph.edges.push({ id: `e-agent-${files.name}-${name}`, source: agentId, target: node.id, order: 0 });
    }
  }
}
