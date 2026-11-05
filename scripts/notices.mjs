/**
 * public/third-party-notices.txt: every production npm package that ships inside
 * McBot (the window and the engine), with its licence text, as MIT, Apache-2.0
 * and the others require. Read from package-lock.json (non-dev entries) and each
 * package's own LICENSE file. Run before every UI build; the About screen shows it.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
const LICENCE_FILE = /^(licen[cs]e|copying|notice)(\..*)?$/i;

const entries = Object.entries(lock.packages)
  .filter(([path, p]) => path && !p.dev && path.startsWith("node_modules/"))
  .map(([path, p]) => ({ path, name: path.replace(/^.*node_modules\//, ""), version: p.version ?? "", license: p.license ?? "" }))
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const seen = new Set();
const blocks = [];
for (const e of entries) {
  const key = `${e.name}@${e.version}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const dir = join(ROOT, e.path);
  let license = e.license;
  let texts = [];
  if (existsSync(dir)) {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    license ||= typeof pkg.license === "string" ? pkg.license : pkg.license?.type ?? "";
    texts = readdirSync(dir).filter((f) => LICENCE_FILE.test(f)).sort().map((f) => readFileSync(join(dir, f), "utf8").trim());
  }
  blocks.push([`${e.name} ${e.version}`, `License: ${license || "see package"}`, "", ...(texts.length ? texts : ["(No licence file in the package; see its license field above.)"])].join("\n"));
}

const head = [
  "McBot includes the following open-source software.",
  "",
  "Also inside: Node.js (MIT, https://github.com/nodejs/node/blob/main/LICENSE), which runs McBot's engine;",
  "the desktop shell is built with Tauri (MIT or Apache-2.0, https://github.com/tauri-apps/tauri) and Rust crates under MIT or Apache-2.0;",
  "The engine keeps its own licence file and third-party notices in its folder inside the app.",
].join("\n");
mkdirSync(join(ROOT, "public"), { recursive: true });
writeFileSync(join(ROOT, "public", "third-party-notices.txt"), `${head}\n\n${"=".repeat(72)}\n\n${blocks.join(`\n\n${"=".repeat(72)}\n\n`)}\n`);
console.log(`public/third-party-notices.txt: ${blocks.length} packages`);
