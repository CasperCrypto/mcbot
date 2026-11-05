/**
 * McBot's changes to Hermes, as patch files: patches/hermes/<path>.patch, one
 * per changed file, each against the upstream commit in hermes/UPSTREAM.json.
 *
 * hermes/ stays a full copy with the patches applied (builds are offline and
 * the installer ships it as is). The patch files are the record: `check` fails
 * when one is no longer applied in hermes/ (an edit or a sync lost it), and
 * `npm test` runs it, so a lost patch cannot go unnoticed.
 *
 *   npx tsx scripts/hermes-patches.ts check
 *   npx tsx scripts/hermes-patches.ts make <hermes-agent checkout>   (rewrite from hermes/ vs upstream)
 *
 * `make` is also run by scripts/hermes-sync.ts after a sync, which then refuses
 * if a file that had a patch no longer differs from upstream.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PATCH_DIR = join(ROOT, "patches", "hermes");
/** McBot's own files in hermes/, not patches of upstream ones. */
const OURS = new Set(["MCBOT.md", "UPSTREAM.json"]);

const patchName = (path: string) => `${path.replace(/\//g, "__")}.patch`;
const pathOf = (patch: string) => patch.replace(/\.patch$/, "").replace(/__/g, "/");

/** Paths (inside hermes/) that have a patch file. */
export function patchedFiles(): string[] {
  if (!existsSync(PATCH_DIR)) return [];
  return readdirSync(PATCH_DIR).filter((f) => f.endsWith(".patch")).map(pathOf).sort();
}

/** Patches that are no longer applied in hermes/ (empty = every patch is there). */
export function checkPatches(): { file: string; problem: string }[] {
  const out: { file: string; problem: string }[] = [];
  for (const file of patchedFiles()) {
    const patch = join(PATCH_DIR, patchName(file));
    const text = readFileSync(patch, "utf8");
    if (!/^\+.*McBot:/m.test(text)) out.push({ file, problem: "the change is not marked `McBot:`" });
    // Applies in reverse = every hunk is present in hermes/ as written.
    const r = spawnSync("git", ["-C", ROOT, "apply", "--reverse", "--check", patch], { encoding: "utf8" });
    if (r.status !== 0) out.push({ file, problem: `not applied in hermes/: ${(r.stderr || r.stdout).trim().split("\n")[0]}` });
  }
  return out;
}

/** Rewrite patches/hermes/ from the difference between hermes/ and upstream at `commit`. Returns the patched paths. */
export function makePatches(upstream: string, commit: string): string[] {
  const git = (repo: string, ...args: string[]) => execFileSync("git", ["-C", repo, ...args], { maxBuffer: 1 << 30 }).toString();
  // Compare git blob ids, which ignore checkout line endings (Hermes' .ps1 files check out as CRLF).
  const theirs = new Map(git(upstream, "ls-tree", "-r", commit).split("\n").filter(Boolean).map((l) => {
    const [meta, path] = l.split("\t") as [string, string];
    return [path, meta.split(" ")[2]!];
  }));
  const ours = new Map(git(ROOT, "ls-files", "-s", "hermes").split("\n").filter(Boolean).map((l) => {
    const [meta, path] = l.split("\t") as [string, string];
    return [path.replace(/^hermes\//, ""), meta.split(" ")[1]!];
  }));
  for (const p of git(ROOT, "diff", "--name-only", "--", "hermes").split("\n").filter(Boolean)) ours.set(p.replace(/^hermes\//, ""), "worktree");

  const changed = [...ours].filter(([p, id]) => !OURS.has(p) && theirs.has(p) && theirs.get(p) !== id).map(([p]) => p).sort();
  const tmp = mkdtempSync(join(tmpdir(), "hermes-patches-"));
  rmSync(PATCH_DIR, { recursive: true, force: true });
  mkdirSync(PATCH_DIR, { recursive: true });
  const made: string[] = [];
  for (const p of changed) {
    const original = join(tmp, "original");
    writeFileSync(original, execFileSync("git", ["-C", upstream, "show", `${commit}:${p}`], { maxBuffer: 1 << 30 }));
    const norm = (s: string) => s.replace(/\r\n/g, "\n");
    if (norm(readFileSync(original, "latin1")) === norm(readFileSync(join(ROOT, "hermes", p), "latin1"))) continue;
    const r = spawnSync("diff", ["-u", "-L", `a/hermes/${p}`, "-L", `b/hermes/${p}`, original, join(ROOT, "hermes", p)], { encoding: "utf8", maxBuffer: 1 << 28 });
    if (r.status !== 1) throw new Error(`diff failed for ${p}: ${r.stderr}`);
    writeFileSync(join(PATCH_DIR, patchName(p)), r.stdout);
    made.push(p);
  }
  rmSync(tmp, { recursive: true, force: true });
  return made;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, checkout] = process.argv.slice(2);
  if (cmd === "check") {
    const problems = checkPatches();
    for (const p of problems) console.error(`✗ ${p.file}: ${p.problem}`);
    console.log(problems.length ? `${problems.length} problem(s) in ${patchedFiles().length} patches` : `✓ all ${patchedFiles().length} patches are applied in hermes/`);
    process.exitCode = problems.length ? 1 : 0;
  } else if (cmd === "make" && checkout) {
    const { commit } = JSON.parse(readFileSync(join(ROOT, "hermes", "UPSTREAM.json"), "utf8")) as { commit: string };
    const made = makePatches(resolve(checkout), commit);
    console.log(`patches/hermes/: ${made.length} patch(es) against ${commit.slice(0, 12)}\n  ${made.join("\n  ")}`);
  } else {
    console.error("usage: hermes-patches.ts check | make <hermes-agent checkout>");
    process.exitCode = 2;
  }
}
