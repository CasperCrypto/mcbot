/**
 * compile(graph) → CompileResult (contract 2, src/contracts/compile.ts).
 *
 * Pure and deterministic: no clock, no randomness, no filesystem. The engine
 * writes the result to disk; the UI calls the same function for previews.
 */
import {
  COMPILE_SCHEMA,
  MANIFEST_PATH,
  type CompileResult,
  type CompiledFile,
  type CompiledProfile,
  type FileRole,
} from "../contracts/compile";
import { renderConfig } from "./config";
import { buildManifest, renderManifest } from "./manifest";
import { renderProfileMeta } from "./profileMeta";
import { renderSkill } from "./skill";
import { renderSoul } from "./soul";
import { canonicalText, sha256Hex, utf8Bytes } from "./text";
import { resolveGraph, type Issue } from "./validate";

export { resolveGraph, type Issue, type AgentBundle } from "./validate";
export { mcpToolPrefix, providerKey, providerRef } from "./config";

/** hermes_cli/profiles.py `_PROFILE_DIRS` — what `hermes profile create` bootstraps. */
export const PROFILE_DIRS = ["memories", "sessions", "skills", "skins", "logs", "plans", "workspace", "cron", "home"] as const;

/** hermes_cli/profiles.py `NO_BUNDLED_SKILLS_MARKER`; only its existence is read. */
export const NO_BUNDLED_SKILLS_MARKER = ".no-bundled-skills";

const MARKER_TEXT =
  "Compiled by McBot: this profile's skills come from the board.\n" +
  "Hermes still seeds its essential skills. Delete this file to let `hermes update` seed all bundled skills.\n";

export class CompileError extends Error {
  constructor(readonly issues: Issue[]) {
    super(`Graph has ${issues.length} error(s): ${issues.map((i) => i.message).join("; ")}`);
    this.name = "CompileError";
  }
}

function file(path: string, content: string, role: FileRole, nodeId?: string): CompiledFile {
  const text = canonicalText(content);
  const f: CompiledFile = { path, content: text, sha256: sha256Hex(text), bytes: utf8Bytes(text).length, role };
  if (nodeId !== undefined) f.nodeId = nodeId;
  return f;
}

const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

export function compile(graphInput: unknown): CompileResult {
  const { graph, bundles, issues } = resolveGraph(graphInput);
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length) throw new CompileError(errors);

  const files: CompiledFile[] = [];
  const dirs = new Set<string>([".mcbot", "profiles"]);
  const profiles: CompiledProfile[] = [];

  for (const bundle of bundles) {
    const { agent } = bundle;
    const dir = `profiles/${agent.data.name}`;
    profiles.push({ name: agent.data.name, nodeId: agent.id, dir });
    dirs.add(dir);
    for (const d of PROFILE_DIRS) dirs.add(`${dir}/${d}`);

    files.push(file(`${dir}/SOUL.md`, renderSoul(agent.data), "soul", agent.id));
    files.push(file(`${dir}/config.yaml`, renderConfig(graph, bundle), "config", agent.id));
    const meta = renderProfileMeta(agent.data);
    if (meta !== null) files.push(file(`${dir}/profile.yaml`, meta, "profile-meta", agent.id));
    files.push(file(`${dir}/${NO_BUNDLED_SKILLS_MARKER}`, MARKER_TEXT, "marker", agent.id));
    for (const skill of agent.data.skills) {
      dirs.add(`${dir}/skills/${skill.name}`);
      files.push(file(`${dir}/skills/${skill.name}/SKILL.md`, renderSkill(skill), "skill", agent.id));
    }
  }

  files.sort(byPath);
  const manifest = buildManifest(graph.id, profiles.map((p) => p.name), files);
  files.push(file(MANIFEST_PATH, renderManifest(manifest), "manifest"));
  files.sort(byPath);

  return { schema: COMPILE_SCHEMA, graphId: graph.id, profiles, dirs: [...dirs].sort(), files };
}
