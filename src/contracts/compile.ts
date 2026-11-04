/**
 * Contract 2 of 3 — the compile output layout (docs/BUILD.md §2.2.2).
 *
 * compile(graph) produces exactly this, in memory. The engine writes it under
 * an output root that is a Hermes home (HERMES_HOME), so every agent runs as
 *
 *   HERMES_HOME=<root> hermes -p <agent> ...
 *
 *   <root>/
 *     .mcbot/manifest.json                 McBot-owned: every file below + sha256
 *     profiles/<agent>/                    one Hermes profile per agent node
 *       SOUL.md                            identity (profile root, never cwd)
 *       config.yaml                        model / providers / fallback_providers / mcp_servers
 *       profile.yaml                       description, display_name
 *       .no-bundled-skills                 the profile is exactly what the graph says
 *       skills/<skill>/SKILL.md            one per skill on the agent
 *       memories/ sessions/ skills/ skins/ logs/ plans/ workspace/ cron/ home/
 *                                          the dirs `hermes profile create` bootstraps
 *
 * Paths are POSIX, relative to <root>. Content is UTF-8, LF line endings, no BOM,
 * one trailing newline. The same graph always yields the same bytes.
 */

export const COMPILE_SCHEMA = "mcbot.compile/v1";
export const MANIFEST_PATH = ".mcbot/manifest.json";

export type FileRole = "soul" | "config" | "profile-meta" | "skill" | "marker" | "manifest";

export interface CompiledFile {
  /** POSIX path relative to the output root. */
  path: string;
  content: string;
  /** Lowercase hex SHA-256 of the UTF-8 bytes of `content`. */
  sha256: string;
  /** Byte length of the UTF-8 encoding. */
  bytes: number;
  role: FileRole;
  /** Graph node that produced this file (absent for the manifest). */
  nodeId?: string;
}

export interface CompiledProfile {
  name: string;
  nodeId: string;
  /** "profiles/<name>" */
  dir: string;
}

export interface CompileResult {
  schema: typeof COMPILE_SCHEMA;
  graphId: string;
  profiles: CompiledProfile[];
  /** Directories to ensure exist, sorted. */
  dirs: string[];
  /** Every file to write, sorted by path. The manifest is last-sorted by path too. */
  files: CompiledFile[];
}

export interface ManifestEntry {
  path: string;
  sha256: string;
  bytes: number;
}

export interface Manifest {
  schema: typeof COMPILE_SCHEMA;
  graphId: string;
  profiles: string[];
  files: ManifestEntry[];
}

/** What the engine reports after writing a CompileResult to disk. */
export type FileStatus = "added" | "modified" | "unchanged" | "removed";

export interface FileChange {
  path: string;
  status: FileStatus;
  sha256: string | null;
  previousSha256: string | null;
  bytes: number;
  role: FileRole | null;
  nodeId: string | null;
  /** Unified diff against what was on disk; "" when unchanged. */
  diff: string;
}

export interface CompileReport {
  graphId: string;
  /** Absolute output root (the HERMES_HOME agents run under). */
  root: string;
  written: boolean;
  profiles: CompiledProfile[];
  changes: FileChange[];
}
