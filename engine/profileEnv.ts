/**
 * The keys an agent's run needs, in that agent's `<profile>/.env`.
 *
 * Hermes' gateway serves every profile of a root from one process and reads a
 * served profile's credentials from that profile's `.env` only: it never falls
 * back to its own environment for them (agent/secret_scope.py get_secret,
 * build_profile_secret_scope). So a key McBot passes as a run's environment
 * variable never reaches an agent; it has to be in the profile's `.env`.
 *
 * Right before each run the engine writes the keys that agent's board names
 * (its models' key variables, its makers' keys, `${env:NAME}` in its MCP
 * servers) and that the user saved in McBot, inside a marked block. Lines
 * outside the block (keys someone added with Hermes itself) are kept. The file
 * is owner-only, and the Files view never lists or shows it (engine/folders.ts).
 */
import { chmod, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MEDIA_PROVIDERS } from "../src/contracts/graph";
import type { AgentBundle } from "../src/compile";
import { readTextOrNull } from "./fsutil";

export const ENV_BEGIN = "# >>> McBot keys: rewritten before each run; change them in McBot";
export const ENV_END = "# <<< McBot keys";

/** Files the Files view must never list or show: they hold keys. */
export const SECRET_FILES = new Set([".env", ".op.env"]);

const ENV_REF = /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Every key variable an agent's run may read, by name, sorted. */
export function keyNamesFor(bundle: AgentBundle): string[] {
  const names = new Set<string>();
  for (const m of bundle.models) if (m.data.apiKeyEnv) names.add(m.data.apiKeyEnv);
  for (const maker of [bundle.image, bundle.video]) {
    if (!maker) continue;
    const p = (MEDIA_PROVIDERS[maker.data.media] as Record<string, { keyEnv: string } | undefined>)[maker.data.provider];
    if (p) names.add(p.keyEnv);
  }
  for (const t of bundle.tools)
    for (const v of [...Object.values(t.data.env), ...Object.values(t.data.headers)])
      for (const m of v.matchAll(ENV_REF)) names.add(m[1]!);
  return [...names].sort();
}

/** Hermes' dotenv subset: double quotes with \" and \\ escapes (agent/secret_scope.py _parse_env_value). */
const quote = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** `existing` with McBot's block replaced by `values` (removed when empty), always at the end. */
export function withKeys(existing: string, values: Readonly<Record<string, string>>): string {
  const kept: string[] = [];
  let inBlock = false;
  for (const line of existing.split(/\r?\n/)) {
    if (line === ENV_BEGIN) inBlock = true;
    else if (line === ENV_END) inBlock = false;
    else if (!inBlock) kept.push(line);
  }
  while (kept.length && kept.at(-1) === "") kept.pop();
  const names = Object.keys(values).sort();
  const block = names.length ? [ENV_BEGIN, ...names.map((n) => `${n}=${quote(values[n]!)}`), ENV_END] : [];
  const lines = [...kept, ...(kept.length && block.length ? [""] : []), ...block];
  return lines.length ? `${lines.join("\n")}\n` : "";
}

/** Write the keys for one profile. `profileDir` must already exist (compile made it). */
export async function writeProfileKeys(profileDir: string, values: Readonly<Record<string, string>>): Promise<void> {
  const file = join(profileDir, ".env");
  const before = (await readTextOrNull(file)) ?? "";
  const after = withKeys(before, values);
  if (after === before) return;
  if (!after) {
    await unlink(file).catch(() => undefined);
    return;
  }
  await writeFile(file, after, { mode: 0o600 });
  await chmod(file, 0o600).catch(() => undefined); // no-op on Windows
}
