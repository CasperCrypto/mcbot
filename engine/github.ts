/**
 * Add from GitHub (shell/GitHubSheet.tsx): a repository link, read and put to use. The engine asks
 * GitHub's API what is there (`GET /api/github/inspect`) and says what it is:
 *
 * - a **skill** (a SKILL.md): an agent learns it (Hermes' own GitHub source, engine/skills.ts);
 * - an **MCP server** (package.json on @modelcontextprotocol/sdk, or a Python project on `mcp`):
 *   a tool block wired to an agent, run with `npx -y <package>` or `uvx --from git+<repo> <script>`;
 * - a **Hermes plugin** (a plugin.yaml): `hermes -p <agent> plugins install owner/repo[/path]`
 *   (hermes_cli/plugins_cmd.py `_resolve_git_url` takes that shorthand);
 * - anything else, a **project**: downloaded into the shared files folder for agents to work on.
 *
 * Only GitHub's public API and its archive host are asked; a saved GitHub key raises the rate limit.
 */
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GitHubRepoView } from "../src/contracts/api";

export interface RepoRef {
  owner: string;
  repo: string;
  /** A branch, tag or commit from the link; null = the default branch. */
  ref: string | null;
  /** A folder inside the repository ("" = its root). */
  path: string;
}

export type RepoInfo = GitHubRepoView;
export type RepoKind = GitHubRepoView["kind"];

const SEG = /^[A-Za-z0-9._-]{1,100}$/;

/** `https://github.com/o/r`, `…/tree/main/skills/x`, `…/blob/main/x/SKILL.md`, `git@github.com:o/r.git`, `o/r`. */
export function parseGitHub(input: string): RepoRef | null {
  let t = input.trim().replace(/^git\+/, "");
  const ssh = /^git@github\.com:([^/]+)\/(.+?)(\.git)?$/.exec(t);
  if (ssh) t = `https://github.com/${ssh[1]}/${ssh[2]}`;
  if (!/^https?:\/\//i.test(t)) {
    if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(\/.*)?$/.test(t) || t.includes("..")) return null;
    t = `https://github.com/${t}`;
  }
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return null;
  }
  if (!/^(www\.)?github\.com$/i.test(u.hostname)) return null;
  const parts = u.pathname.split("/").filter(Boolean).map((p) => decodeURIComponent(p));
  if (parts.length < 2) return null;
  const [owner, rawRepo, kind, ref, ...rest] = parts;
  const repo = rawRepo!.replace(/\.git$/, "");
  if (!SEG.test(owner!) || !SEG.test(repo) || repo === "." || repo === "..") return null;
  let path = "";
  let at: string | null = null;
  if ((kind === "tree" || kind === "blob") && ref) {
    at = ref;
    path = rest.join("/");
    // A link to a file means its folder (a SKILL.md link is the skill's folder).
    if (kind === "blob") path = rest.slice(0, -1).join("/");
  }
  if (path.split("/").some((p) => p === ".." || p === ".")) return null;
  return { owner: owner!, repo, ref: at, path };
}

interface PackageJson { name?: string; bin?: string | Record<string, string>; keywords?: string[]; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; private?: boolean }

/** A tool block's name: the repository's, as a lowercase slug. */
export const toolName = (repo: string) => repo.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").replace(/-?mcp-?server-?|-?server-?mcp-?/g, "") .replace(/^-+|-+$/g, "").slice(0, 60) || "tool";

/** What a repository is, from its files: the names in its folder, its package.json and its pyproject.toml. */
export function classify(ref: RepoRef, files: readonly string[], pkg: PackageJson | null, pyproject: string | null): { kind: RepoKind; mcp: RepoInfo["mcp"]; source: string } {
  const has = (f: string) => files.some((x) => x.toLowerCase() === f.toLowerCase());
  const shorthand = `${ref.owner}/${ref.repo}${ref.path ? `/${ref.path}` : ""}`;
  const tree = `https://github.com/${ref.owner}/${ref.repo}${ref.path || ref.ref ? `/tree/${ref.ref ?? "HEAD"}${ref.path ? `/${ref.path}` : ""}` : ""}`;
  if (has("SKILL.md")) return { kind: "skill", mcp: null, source: tree };
  if (has("plugin.yaml")) return { kind: "plugin", mcp: null, source: shorthand };
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const nodeMcp = !!pkg && ("@modelcontextprotocol/sdk" in deps || "fastmcp" in deps || (pkg.keywords ?? []).some((k) => /^(mcp|model-context-protocol)$/i.test(k)));
  if (nodeMcp && pkg) {
    const name = toolName(ref.repo);
    const args = pkg.name && !pkg.private ? ["-y", pkg.name] : ["-y", `github:${ref.owner}/${ref.repo}`];
    return { kind: "mcp", mcp: { name, command: "npx", args }, source: shorthand };
  }
  if (pyproject && /(^|["'\s,[])(mcp|fastmcp)\s*([<>=~![\]"',]|$)/m.test(pyproject)) {
    const scripts = /\[project\.scripts\]\s*\n([\s\S]*?)(\n\[|$)/.exec(pyproject)?.[1] ?? "";
    const script = /^\s*([A-Za-z0-9._-]+)\s*=/m.exec(scripts)?.[1] ?? /^\s*name\s*=\s*["']([^"']+)["']/m.exec(pyproject)?.[1] ?? ref.repo;
    return { kind: "mcp", mcp: { name: toolName(ref.repo), command: "uvx", args: ["--from", `git+https://github.com/${ref.owner}/${ref.repo}`, script] }, source: shorthand };
  }
  return { kind: "project", mcp: null, source: shorthand };
}

const API = "https://api.github.com";
const headers = (token: string | null): Record<string, string> => ({
  "user-agent": "McBot-Studio", accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}),
});

export class GitHubError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function get<T>(url: string, token: string | null): Promise<T> {
  const res = await fetch(url, { headers: headers(token), signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) throw new GitHubError(404, "GitHub has no such repository or folder, or it's private");
  if (res.status === 403 || res.status === 429) {
    // Only GitHub's own limit is "wait": it says so in a header. Any other refusal says why.
    if (res.status === 429 || res.headers.get("x-ratelimit-remaining") === "0") throw new GitHubError(429, "GitHub says to wait a bit (its hourly limit). Save a GitHub key in Passwords to raise it.");
    const why = await res.json().then((b) => String((b as { message?: unknown }).message ?? "")).catch(() => "");
    throw new GitHubError(403, `GitHub refused this${why ? `: ${why.slice(0, 160)}` : ""}`);
  }
  if (!res.ok) throw new GitHubError(502, `GitHub answered ${res.status}`);
  return (await res.json()) as T;
}

/** Ask GitHub what a repository (or a folder in it) is. */
export async function inspectRepo(ref: RepoRef, token: string | null = null): Promise<RepoInfo> {
  const base = `${API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  const repo = await get<{ full_name: string; description: string | null; stargazers_count: number; license: { spdx_id?: string } | null; language: string | null; default_branch: string; html_url: string }>(base, token);
  // A branch may hold slashes (`feature/x`): a link doesn't say where it ends and the folder begins,
  // so the folder is tried with more of it taken as the branch, as GitHub's own pages do.
  type Listing = { name: string; type: string; download_url: string | null }[] | { type: string };
  const parts = ref.path.split("/").filter(Boolean);
  const tries = [{ ref: ref.ref ?? repo.default_branch, path: ref.path }];
  if (ref.ref) for (let i = 1; i <= Math.min(3, parts.length); i++) tries.push({ ref: `${ref.ref}/${parts.slice(0, i).join("/")}`, path: parts.slice(i).join("/") });
  let listing: Listing = [];
  let at = tries[0]!.ref;
  let path = tries[0]!.path;
  for (const t of tries) {
    // The root is `/contents`, a folder `/contents/a/b` (a trailing slash is refused).
    const folder = t.path ? `/${t.path.split("/").map(encodeURIComponent).join("/")}` : "";
    try {
      listing = await get<Listing>(`${base}/contents${folder}?ref=${encodeURIComponent(t.ref)}`, token);
      at = t.ref;
      path = t.path;
      break;
    } catch (err) {
      if (!(err instanceof GitHubError && err.status === 404) || t === tries.at(-1)) throw err;
    }
  }
  const files = Array.isArray(listing) ? listing.map((f) => f.name) : [];
  const read = async (name: string) => {
    const f = Array.isArray(listing) ? listing.find((x) => x.name === name && x.type === "file") : undefined;
    if (!f?.download_url) return null;
    const res = await fetch(f.download_url, { headers: { "user-agent": "McBot-Studio" }, signal: AbortSignal.timeout(15_000) });
    return res.ok ? (await res.text()).slice(0, 200_000) : null;
  };
  let pkg: PackageJson | null = null;
  try {
    const text = await read("package.json");
    pkg = text ? (JSON.parse(text) as PackageJson) : null;
  } catch {
    pkg = null;
  }
  const pyproject = await read("pyproject.toml");
  const spdx = repo.license?.spdx_id;
  return {
    ...ref, ref: at, path, url: path ? `${repo.html_url}/tree/${at}/${path}` : repo.html_url,
    description: repo.description ?? "", stars: repo.stargazers_count ?? 0, license: spdx && spdx !== "NOASSERTION" ? spdx : null, language: repo.language,
    ...classify({ ...ref, ref: at, path }, files, pkg, pyproject),
  };
}

const run = (file: string, args: string[]) => new Promise<void>((resolve, reject) => {
  const child = spawn(file, args, { stdio: "ignore", windowsHide: true });
  child.on("error", reject);
  child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${file} exited ${code}`))));
});

/** At most this much is downloaded (a repository is a project, not a dataset). */
export const MAX_ARCHIVE = 80 * 1024 * 1024;

/**
 * A repository's files, unpacked into `<into>/<repo>` (the shared files folder's `github/`), from
 * GitHub's archive of that branch. `tar` ships with macOS, Linux and Windows 10 and later.
 */
export async function downloadRepo(ref: RepoRef, into: string, token: string | null = null): Promise<string> {
  const at = ref.ref ?? "HEAD";
  const res = await fetch(`${API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/tarball/${encodeURIComponent(at)}`, { headers: headers(token), signal: AbortSignal.timeout(120_000) });
  if (res.status === 404) throw new GitHubError(404, "GitHub has no such repository, or it's private");
  if (!res.ok) throw new GitHubError(502, `GitHub answered ${res.status}`);
  const size = Number(res.headers.get("content-length") ?? 0);
  if (size > MAX_ARCHIVE) throw new GitHubError(413, "This repository is too large to download here");
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_ARCHIVE) throw new GitHubError(413, "This repository is too large to download here");
  const dest = join(into, ref.repo);
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  const archive = join(into, `.${ref.repo}.tar.gz`);
  await writeFile(archive, bytes);
  try {
    await run("tar", ["-xzf", archive, "-C", dest, "--strip-components=1"]);
  } finally {
    await rm(archive, { force: true });
  }
  return dest;
}
