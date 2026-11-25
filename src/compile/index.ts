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
import { DEFAULT_CAPABILITIES, MEDIA_PROVIDERS, type MediaNode, type ModelData } from "../contracts/graph";
import { renderConfig } from "./config";
import { GUIDE_CATEGORY, GUIDE_NAME, GUIDE_PATH, renderMcbotGuide } from "./mcbotGuide";
import { DOCS_DIR, renderDocsSkill } from "./docs";
import { buildManifest, renderManifest } from "./manifest";
import { renderProfileMeta } from "./profileMeta";
import { renderSkill } from "./skill";
import { renderSoul, type WhereFacts } from "./soul";
import { canonicalText, sha256Hex, utf8Bytes } from "./text";
import { resolveGraph, type AgentBundle, type Issue } from "./validate";

export { resolveGraph, type Issue, type AgentBundle } from "./validate";
export { mcpToolPrefix, providerKey, providerRef } from "./config";

/** hermes_cli/profiles.py `_PROFILE_DIRS` — what `hermes profile create` bootstraps. */
export const PROFILE_DIRS = ["memories", "sessions", "skills", "skins", "logs", "plans", "workspace", "cron", "home"] as const;

/** hermes_cli/profiles.py `NO_BUNDLED_SKILLS_MARKER`; only its existence is read. */
export const NO_BUNDLED_SKILLS_MARKER = ".no-bundled-skills";

const MARKER_TEXT =
  "Compiled by McBot: Hermes' bundled skills are turned off for this agent on the board.\n" +
  "Hermes still seeds its essential skills. Turn bundled skills on in McBot to get them all.\n";

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

/** Cloud services by their API's host, as people say them; any other host is named as it is. */
const SERVICES: Record<string, string> = {
  "openrouter.ai": "OpenRouter", "api.openai.com": "OpenAI", "api.anthropic.com": "Anthropic",
  "generativelanguage.googleapis.com": "Gemini", "api.groq.com": "Groq", "api.deepseek.com": "DeepSeek",
  "api.mistral.ai": "Mistral", "api.together.xyz": "Together", "api.x.ai": "xAI", "opencode.ai": "OpenCode",
  "api.concentrate.ai": "Concentrate", "api.fireworks.ai": "Fireworks", "api.deepinfra.com": "DeepInfra",
};

/** Where a model runs, in words, from what config.yaml holds: "on this computer", "through OpenRouter". */
function modelWhere(m: ModelData): string {
  if (m.endpoint === "local") return "on this computer";
  let host = "";
  try {
    host = new URL(m.baseUrl).hostname.toLowerCase();
  } catch {
    return "in the cloud";
  }
  return `through ${SERVICES[host] ?? host}`;
}

/** A maker as people name it: "Image maker (OpenRouter)". */
function makerName(n: MediaNode): string {
  const services = MEDIA_PROVIDERS[n.data.media] as Record<string, { label: string }>;
  return `${n.data.media === "image" ? "Image" : "Video"} maker (${services[n.data.provider]?.label ?? n.data.provider})`;
}

/** What an agent's block and wires say about it: its "Where you work" section (compile/soul.ts). */
export function whereFacts(b: AgentBundle): WhereFacts {
  return {
    models: b.models.map((m) => ({ model: m.data.model.trim(), where: modelWhere(m.data) })),
    tools: [...b.tools.map((t) => t.data.name), ...[b.image, b.video].filter((n): n is MediaNode => !!n).map(makerName)],
    skills: (b.agent.data.capabilities ?? DEFAULT_CAPABILITIES).includes("skills"),
  };
}

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

    const where = whereFacts(bundle);
    files.push(file(`${dir}/SOUL.md`, renderSoul(agent.data, bundle.team.map((t) => t.data), graph.brief, where), "soul", agent.id));
    files.push(file(`${dir}/config.yaml`, renderConfig(graph, bundle), "config", agent.id));
    const meta = renderProfileMeta(agent.data);
    if (meta !== null) files.push(file(`${dir}/profile.yaml`, meta, "profile-meta", agent.id));
    // Hermes' bundled skills are on unless the board turns them off (the engine seeds them after a
    // compile with `hermes -p <agent> skills opt-in --sync`, engine/skills.ts).
    if (agent.data.builtinSkills === false) files.push(file(`${dir}/${NO_BUNDLED_SKILLS_MARKER}`, MARKER_TEXT, "marker", agent.id));
    // McBot's own guide, so the agent can answer how McBot works (compile/mcbotGuide.ts).
    if (where.skills) {
      dirs.add(`${dir}/skills/${GUIDE_CATEGORY}`);
      dirs.add(`${dir}/skills/${GUIDE_CATEGORY}/${GUIDE_NAME}`);
      files.push(file(`${dir}/${GUIDE_PATH}`, renderMcbotGuide(), "skill", agent.id));
      // The board's documents, read with skill_view when a question needs them (compile/docs.ts).
      const docs = renderDocsSkill(graph.docs);
      if (docs.length) {
        dirs.add(`${dir}/${DOCS_DIR}`);
        dirs.add(`${dir}/${DOCS_DIR}/references`);
      }
      for (const d of docs) files.push(file(`${dir}/${d.path}`, d.content, "skill", agent.id));
    }
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
