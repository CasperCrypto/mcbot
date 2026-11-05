/**
 * Has upstream Hermes changed a file McBot patches since our pinned commit?
 *
 * Reads the pin (hermes/UPSTREAM.json) and the patched files (patches/hermes/),
 * fetches upstream history since the pin with plain git (no API, no token),
 * lists the commits that touch each patched file, and writes a Markdown report.
 * Run daily by .github/workflows/hermes-upstream.yml, which opens or updates an
 * issue when anything moved: the next sync has to merge those files with our
 * patches, so better to know before a user hits it.
 *
 *   node scripts/hermes-upstream-check.mjs [report.md]
 * Prints the report; sets `changed` and `ahead` in $GITHUB_OUTPUT when present.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pin = JSON.parse(readFileSync(join(ROOT, "hermes", "UPSTREAM.json"), "utf8"));
const web = pin.upstream.replace(/\.git$/, "");
const patched = readdirSync(join(ROOT, "patches", "hermes")).filter((f) => f.endsWith(".patch"))
  .map((f) => f.replace(/\.patch$/, "").replace(/__/g, "/")).sort();

const dir = mkdtempSync(join(tmpdir(), "hermes-upstream-"));
const git = (...args) => execFileSync("git", ["-C", dir, ...args], { maxBuffer: 1 << 28 }).toString().trim();
let report;
let moved = [];
let ahead = 0;
try {
  git("init", "-q");
  // History back to a day before the pin, so the pinned commit is there to compare against.
  const since = new Date(new Date(pin.date).getTime() - 86_400_000).toISOString();
  git("fetch", "-q", `--shallow-since=${since}`, pin.upstream, "HEAD");
  const head = git("rev-parse", "FETCH_HEAD");
  let known = true;
  try {
    git("cat-file", "-e", `${pin.commit}^{commit}`);
  } catch {
    known = false; // the pin is not on upstream's main line (rebased away): fall back to dates
  }
  const range = known ? [`${pin.commit}..${head}`] : [`--since=${pin.date}`, head];
  ahead = Number(git("rev-list", "--count", ...range));
  for (const file of patched) {
    const out = git("log", "--format=%H%x09%s", ...range, "--", file);
    if (out) moved.push({ file, commits: out.split("\n").map((l) => { const [sha, subject] = l.split("\t"); return { sha, subject }; }) });
  }

  const short = (sha) => sha.slice(0, 10);
  const lines = [
    `McBot's engine is pinned at [\`${short(pin.commit)}\`](${web}/commit/${pin.commit}) (${pin.date.slice(0, 10)}).`,
    `Upstream is at [\`${short(head)}\`](${web}/commit/${head}), ${ahead} commit(s) ahead${known ? "" : " (counted by date: the pinned commit is no longer on upstream's main line)"}.`,
    "",
  ];
  if (moved.length) {
    lines.push(`**${moved.length} of the ${patched.length} files McBot patches changed upstream.** The next \`npm run engine:sync\` merges them with our patches (\`patches/hermes/\`); check those merges by hand.`, "");
    for (const m of moved) {
      lines.push(`- \`${m.file}\`: ${m.commits.length} commit(s)`);
      for (const c of m.commits.slice(0, 5)) lines.push(`  - [\`${short(c.sha)}\`](${web}/commit/${c.sha}) ${c.subject.slice(0, 100)}`);
    }
  } else {
    lines.push(`None of the ${patched.length} files McBot patches changed upstream. A sync takes upstream as it is.`);
  }
  lines.push("", "_Written by `scripts/hermes-upstream-check.mjs`._");
  report = `${lines.join("\n")}\n`;
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(report);
if (process.argv[2]) writeFileSync(process.argv[2], report);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${moved.length > 0}\nahead=${ahead}\n`);
