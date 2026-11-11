/**
 * Keep hermes/ (our fork of Hermes Agent, MIT) in step with upstream while
 * keeping McBot's changes.
 *
 *   npx tsx scripts/hermes-sync.ts --init <upstream-checkout>
 *       copy the runtime from the checkout's HEAD into hermes/
 *   npx tsx scripts/hermes-sync.ts <upstream-checkout> [ref]
 *       move hermes/ from the recorded upstream commit to <ref> (default HEAD):
 *       files we never touched take upstream's version, files we changed are
 *       three-way merged (git merge-file), conflicts are listed for a human.
 *
 * Only the runtime comes in: tests, the website, Hermes' own apps, evals and
 * CI are left out (EXCLUDE). hermes/UPSTREAM.json records the commit.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { makePatches, patchedFiles } from "./hermes-patches";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const DEST = join(ROOT, "hermes");
const RECORD = join(DEST, "UPSTREAM.json");
export const EXCLUDE = ["tests/", "tests-js/", "website/", "apps/", "contributors/", "evals/", ".github/", "nix/"];
const keep = (p: string) => !EXCLUDE.some((x) => p.startsWith(x));

const git = (repo: string, ...args: string[]) => execFileSync("git", ["-C", repo, ...args], { maxBuffer: 1 << 30 });
const files = (repo: string, ref: string) => git(repo, "ls-tree", "-r", "-z", "--name-only", ref).toString().split("\0").filter((p) => p && keep(p));
const blob = (repo: string, ref: string, path: string): Buffer | null => {
  try {
    return git(repo, "show", `${ref}:${path}`);
  } catch {
    return null;
  }
};
const mode = (repo: string, ref: string, path: string) => git(repo, "ls-tree", ref, "--", path).toString().split(" ")[0];
const write = (path: string, data: Buffer, exec: boolean) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data, { mode: exec ? 0o755 : 0o644 });
};

function record(repo: string, commit: string) {
  const url = git(repo, "remote", "get-url", "origin").toString().trim();
  const date = git(repo, "show", "-s", "--format=%cI", commit).toString().trim();
  writeFileSync(RECORD, `${JSON.stringify({ upstream: url, commit, date, exclude: EXCLUDE }, null, 2)}\n`);
}

function init(repo: string) {
  if (existsSync(DEST) && existsSync(RECORD)) throw new Error("hermes/ exists; run without --init to update it");
  const commit = git(repo, "rev-parse", "HEAD").toString().trim();
  let n = 0;
  for (const p of files(repo, commit)) {
    write(join(DEST, p), blob(repo, commit, p)!, mode(repo, commit, p) === "100755");
    n++;
  }
  record(repo, commit);
  console.log(`hermes/: ${n} files from ${commit.slice(0, 12)}`);
}

function update(repo: string, ref: string) {
  const { commit: base } = JSON.parse(readFileSync(RECORD, "utf8")) as { commit: string };
  // ^{commit}: a release tag names a tag object; UPSTREAM.json records the commit it points to.
  const next = git(repo, "rev-parse", `${ref}^{commit}`).toString().trim();
  if (next === base) return console.log("hermes/ is already at", base.slice(0, 12));
  const tmp = join(tmpdir(), `hermes-sync-${process.pid}`);
  mkdirSync(tmp, { recursive: true });
  const conflicts: string[] = [];
  let taken = 0, merged = 0, removed = 0;
  const paths = new Set([...files(repo, base), ...files(repo, next)]);
  for (const p of paths) {
    const dest = join(DEST, p);
    const old = blob(repo, base, p);
    const theirs = blob(repo, next, p);
    const ours = existsSync(dest) ? readFileSync(dest) : null;
    // .ps1 files check out with CRLF (Hermes' .gitattributes); compare line endings loosely.
    const same = (a: Buffer, b: Buffer) => a.equals(b) || a.toString("latin1").replace(/\r\n/g, "\n") === b.toString("latin1").replace(/\r\n/g, "\n");
    const untouched = (ours === null && old === null) || (ours !== null && old !== null && same(ours, old));
    if (theirs === null) {
      if (untouched && ours) { rmSync(dest); removed++; } else if (ours) conflicts.push(`${p} (removed upstream, changed here)`);
      continue;
    }
    if (untouched || ours === null) { write(dest, theirs, mode(repo, next, p) === "100755"); taken++; continue; }
    if (old && theirs.equals(old)) continue; // only we changed it
    const [o, b, t] = ["ours", "base", "theirs"].map((n) => join(tmp, n));
    writeFileSync(o!, ours); writeFileSync(b!, old ?? Buffer.alloc(0)); writeFileSync(t!, theirs);
    try {
      execFileSync("git", ["merge-file", o!, b!, t!]);
      merged++;
    } catch {
      conflicts.push(p);
    }
    writeFileSync(dest, readFileSync(o!));
  }
  rmSync(tmp, { recursive: true, force: true });
  record(repo, next);
  console.log(`hermes/: ${base.slice(0, 12)} → ${next.slice(0, 12)}; ${taken} updated, ${merged} merged with our changes, ${removed} removed`);
  // Our patches, rewritten against the new upstream. A file that had one and now matches upstream
  // lost McBot's change (or upstream took it, then drop it from hermes/MCBOT.md on purpose).
  const before = patchedFiles();
  const made = makePatches(repo, next);
  const lost = before.filter((p) => !made.includes(p) && !conflicts.includes(p));
  console.log(`patches/hermes/: ${made.length} patch(es) against ${next.slice(0, 12)}`);
  if (lost.length) {
    console.log(`McBot's change is gone from these (upstream took it, or the merge dropped it):\n  ${lost.join("\n  ")}`);
    process.exitCode = 1;
  }
  if (conflicts.length) {
    console.log(`Resolve these (conflict markers are in the files):\n  ${conflicts.join("\n  ")}`);
    process.exitCode = 1;
  }
}

/** Upstream tracks some files its own .gitignore matches (built dashboards, fonts); git skips them unless forced. */
function reportIgnored() {
  const tracked = new Set(execFileSync("git", ["-C", ROOT, "ls-files", "hermes"], { maxBuffer: 1 << 28 }).toString().split("\n"));
  let ignored: string[] = [];
  try {
    ignored = execFileSync("git", ["-C", ROOT, "ls-files", "--others", "--ignored", "--exclude-standard", "hermes"], { maxBuffer: 1 << 28 }).toString()
      .split("\n").filter((p) => p && !tracked.has(p) && !/__pycache__|\.hermes-runtime|\/\.hermes\//.test(p));
  } catch {
    return;
  }
  const upstream = new Set(files(...lastRecord()).map((p) => `hermes/${p}`));
  const needed = ignored.filter((p) => upstream.has(p));
  if (needed.length) console.log(`Upstream tracks ${needed.length} file(s) hermes/.gitignore matches; add them with:\n  git add -f ${needed.join(" ")}`);
}
let last: [string, string] | null = null;
const lastRecord = (): [string, string] => last!;

const args = process.argv.slice(2);
if (args[0] === "--init" && args[1]) {
  init(resolve(args[1]));
  last = [resolve(args[1]), (JSON.parse(readFileSync(RECORD, "utf8")) as { commit: string }).commit];
  reportIgnored();
} else if (args[0]) {
  update(resolve(args[0]), args[1] ?? "HEAD");
  last = [resolve(args[0]), (JSON.parse(readFileSync(RECORD, "utf8")) as { commit: string }).commit];
  reportIgnored();
}
else {
  console.error("usage: hermes-sync.ts --init <upstream-checkout> | <upstream-checkout> [ref]");
  process.exitCode = 2;
}
